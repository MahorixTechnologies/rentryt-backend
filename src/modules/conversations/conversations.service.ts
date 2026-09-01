import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import type { AuthUser } from '../../common/types/auth';
import { UserRole } from '../../common/types/auth';
import { PrismaService } from '../../prisma/prisma.service';
import {
  NotificationsService,
  NotificationType,
} from '../notifications/notifications.service';

const MESSAGE_PREVIEW_MAX = 140;

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

type ConversationRecord = {
  id: string;
  renterId: string;
  ownerId: string;
};

/**
 * Renter <-> owner in-app chat, tied to a listing inquiry or an existing
 * booking. See the Conversation/Message model doc comments in schema.prisma
 * for the duplicate-thread-prevention reasoning (the two compound unique
 * constraints); this service still does a read-check-then-create with a
 * catch-and-refetch on P2002 to stay correct under a concurrent race.
 */
@Injectable()
export class ConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  private assertParticipant(actor: AuthUser, conversation: ConversationRecord) {
    if (
      actor.id !== conversation.renterId &&
      actor.id !== conversation.ownerId
    ) {
      throw new ForbiddenException('not a participant in this conversation');
    }
  }

  private async findConversationOrThrow(id: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id },
    });
    if (!conversation) throw new NotFoundException('conversation not found');
    return conversation;
  }

  async createConversation(
    actor: AuthUser,
    params: { listingId?: string; bookingId?: string },
  ) {
    const { listingId, bookingId } = params;
    if (!listingId && !bookingId) {
      throw new BadRequestException('listingId or bookingId is required');
    }
    if (listingId && bookingId) {
      throw new BadRequestException(
        'provide only one of listingId or bookingId',
      );
    }

    if (bookingId) {
      return await this.createFromBooking(actor, bookingId);
    }
    return await this.createFromListing(actor, listingId as string);
  }

  private async createFromListing(actor: AuthUser, listingId: string) {
    // Only a renter can open a fresh listing inquiry — an owner has no
    // reason to message themselves about their own listing, and there is no
    // "other" owner participant to derive for a listing-based thread.
    if (actor.role !== UserRole.RENTER) {
      throw new ForbiddenException('only renters may start a listing inquiry');
    }

    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
      select: { id: true, ownerId: true },
    });
    if (!listing) throw new NotFoundException('listing not found');
    if (listing.ownerId === actor.id) {
      throw new ForbiddenException(
        'cannot message yourself about your own listing',
      );
    }

    const existing = await this.prisma.conversation.findUnique({
      where: { renterId_listingId: { renterId: actor.id, listingId } },
    });
    if (existing) return existing;

    try {
      return await this.prisma.conversation.create({
        data: { listingId, renterId: actor.id, ownerId: listing.ownerId },
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        const raced = await this.prisma.conversation.findUnique({
          where: { renterId_listingId: { renterId: actor.id, listingId } },
        });
        if (raced) return raced;
      }
      throw error;
    }
  }

  private async createFromBooking(actor: AuthUser, bookingId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { listing: { select: { ownerId: true } } },
    });
    if (!booking) throw new NotFoundException('booking not found');

    const isRenter = actor.id === booking.renterId;
    const isOwningLandlord =
      actor.role === UserRole.LANDLORD && actor.id === booking.listing.ownerId;
    if (!isRenter && !isOwningLandlord) {
      throw new ForbiddenException('not a participant in this booking');
    }

    const existing = await this.prisma.conversation.findUnique({
      where: { renterId_bookingId: { renterId: booking.renterId, bookingId } },
    });
    if (existing) return existing;

    try {
      return await this.prisma.conversation.create({
        data: {
          bookingId,
          renterId: booking.renterId,
          ownerId: booking.listing.ownerId,
        },
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        const raced = await this.prisma.conversation.findUnique({
          where: {
            renterId_bookingId: { renterId: booking.renterId, bookingId },
          },
        });
        if (raced) return raced;
      }
      throw error;
    }
  }

  /** Mine as either renter or owner, newest activity (updatedAt) first. */
  async listMine(actor: AuthUser) {
    const conversations = await this.prisma.conversation.findMany({
      where: { OR: [{ renterId: actor.id }, { ownerId: actor.id }] },
      orderBy: { updatedAt: 'desc' },
      include: {
        renter: { select: { id: true, name: true, email: true, phone: true } },
        owner: { select: { id: true, name: true, email: true, phone: true } },
        listing: { select: { id: true, title: true } },
        booking: { select: { id: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });

    return conversations.map((conversation) => {
      const isRenter = conversation.renterId === actor.id;
      const { renter, owner, messages, ...rest } = conversation;
      return {
        ...rest,
        otherParticipant: isRenter ? owner : renter,
        latestMessage: messages[0] ?? null,
      };
    });
  }

  async getMessages(actor: AuthUser, conversationId: string) {
    const conversation = await this.findConversationOrThrow(conversationId);
    this.assertParticipant(actor, conversation);

    return await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async sendMessage(actor: AuthUser, conversationId: string, body: string) {
    const trimmed = body.trim();
    if (!trimmed) throw new BadRequestException('body is required');

    const conversation = await this.findConversationOrThrow(conversationId);
    this.assertParticipant(actor, conversation);

    // Nested create through an update to the parent so Conversation.updatedAt
    // (the "newest activity" sort key for listMine) bumps in the same
    // statement Prisma issues for @updatedAt, instead of a separate touch.
    const updated = await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { messages: { create: { senderId: actor.id, body: trimmed } } },
      include: { messages: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    const message = updated.messages[0];

    const recipientId =
      actor.id === conversation.renterId
        ? conversation.ownerId
        : conversation.renterId;
    const preview =
      trimmed.length > MESSAGE_PREVIEW_MAX
        ? `${trimmed.slice(0, MESSAGE_PREVIEW_MAX)}…`
        : trimmed;
    await this.notifications.notify(recipientId, {
      type: NotificationType.NEW_MESSAGE,
      title: 'New message',
      body: preview,
      data: { conversationId, messageId: message.id },
    });

    return message;
  }

  /** Marks every message in the thread not sent by the caller as read. */
  async markRead(actor: AuthUser, conversationId: string) {
    const conversation = await this.findConversationOrThrow(conversationId);
    this.assertParticipant(actor, conversation);

    const result = await this.prisma.message.updateMany({
      where: { conversationId, senderId: { not: actor.id }, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: result.count };
  }

  /**
   * Admin support-visibility only — read-only, identical shape to
   * getMessages, but no ownership/participant check (an admin is never a
   * participant) and deliberately no write counterpart anywhere on this
   * path, so support access can never alter thread history.
   */
  async getMessagesForAdmin(conversationId: string) {
    await this.findConversationOrThrow(conversationId);
    return await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
    });
  }
}
