import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import type { AuthUser } from '../types/auth';
import { PrismaService } from '../../prisma/prisma.service';

import { STORAGE_SERVICE, type StorageService } from './storage.interface';
import {
  ALLOWED_IMAGE_TYPES,
  MAX_UPLOAD_BYTES,
  PRESIGN_TTL_SECONDS,
  STORAGE_PURPOSE_LISTING_IMAGE,
  buildObjectKey,
  extensionForContentType,
} from './storage.util';

const ALLOWED_PURPOSES = new Set([STORAGE_PURPOSE_LISTING_IMAGE]);

@Injectable()
export class StorageUploadsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
  ) {}

  async createUpload(
    user: AuthUser,
    input: { filename: string; contentType: string; purpose: string },
    apiBase: string,
  ) {
    if (!ALLOWED_PURPOSES.has(input.purpose)) {
      throw new BadRequestException('unsupported upload purpose');
    }
    if (!ALLOWED_IMAGE_TYPES.has(input.contentType)) {
      throw new BadRequestException('contentType must be image/jpeg, image/png, or image/webp');
    }

    const filename = input.filename?.trim()
      ? input.filename
      : `upload.${extensionForContentType(input.contentType)}`;
    const key = buildObjectKey(filename);
    const presign = await this.storage.presign({
      key,
      contentType: input.contentType,
      filename,
      apiBase,
    });

    const row = await this.prisma.storageObject.create({
      data: {
        userId: user.id,
        key,
        publicUrl: presign.publicUrl,
        purpose: input.purpose,
        contentType: input.contentType,
        status: 'PENDING',
        expiresAt: new Date(Date.now() + PRESIGN_TTL_SECONDS * 1000),
      },
    });

    return {
      id: row.id,
      key: row.key,
      publicUrl: row.publicUrl,
      uploadUrl: presign.uploadUrl,
      headers: presign.headers,
      expiresIn: presign.expiresIn,
    };
  }

  async complete(user: AuthUser, id: string) {
    const row = await this.requireOwned(user, id);
    if (row.status === 'ABORTED' || row.status === 'EXPIRED') {
      throw new ConflictException('upload is no longer available');
    }
    if (row.status === 'UPLOADED' || row.status === 'ATTACHED') {
      return this.toView(row);
    }

    const exists =
      (await this.storage.exists(row.key)) ||
      (await this.storage.exists(row.publicUrl));
    if (!exists) {
      throw new BadRequestException('upload not found — PUT the file first');
    }

    const updated = await this.prisma.storageObject.update({
      where: { id: row.id },
      data: { status: 'UPLOADED' },
    });
    return this.toView(updated);
  }

  async abort(user: AuthUser, id: string) {
    const row = await this.requireOwned(user, id);
    if (row.status === 'ATTACHED') {
      throw new BadRequestException(
        'attached uploads must be removed by updating the listing images',
      );
    }
    if (row.status === 'ABORTED' || row.status === 'EXPIRED') {
      return this.toView(row);
    }

    await this.storage.delete(row.key);
    if (row.publicUrl !== row.key) {
      await this.storage.delete(row.publicUrl);
    }

    const updated = await this.prisma.storageObject.update({
      where: { id: row.id },
      data: { status: 'ABORTED', listingId: null },
    });
    return this.toView(updated);
  }

  async putLocal(
    user: AuthUser,
    encodedKey: string,
    buffer: Buffer,
    contentType: string,
  ) {
    const key = decodeURIComponent(encodedKey);
    const row = await this.prisma.storageObject.findUnique({ where: { key } });
    if (!row) throw new NotFoundException('upload session not found');
    if (row.userId !== user.id) throw new ForbiddenException('not allowed');
    if (row.status === 'ABORTED' || row.status === 'EXPIRED') {
      throw new ConflictException('upload is no longer available');
    }
    if (buffer.length === 0) {
      throw new BadRequestException('empty file');
    }
    if (buffer.length > MAX_UPLOAD_BYTES) {
      throw new BadRequestException('file exceeds 5MB');
    }
    if (contentType && contentType !== row.contentType) {
      throw new BadRequestException('Content-Type does not match the presigned upload');
    }

    const file = {
      buffer,
      mimetype: row.contentType,
      originalname: key.split('/').pop() ?? 'upload',
    } as Express.Multer.File;

    const publicUrl = await this.storage.upload(file, row.key);
    const updated = await this.prisma.storageObject.update({
      where: { id: row.id },
      data: { publicUrl },
    });
    return this.toView(updated);
  }

  async syncListingImages(params: {
    userId: string;
    listingId: string;
    nextImages: string[];
    previousImages: string[];
  }) {
    const next = new Set(params.nextImages);
    const previous = new Set(params.previousImages);
    const added = params.nextImages.filter((url) => !previous.has(url));
    const removed = params.previousImages.filter((url) => !next.has(url));

    if (added.length) {
      await this.prisma.storageObject.updateMany({
        where: {
          userId: params.userId,
          publicUrl: { in: added },
          status: { in: ['PENDING', 'UPLOADED'] },
        },
        data: { status: 'ATTACHED', listingId: params.listingId },
      });
    }

    if (!removed.length) return;

    const detached = await this.prisma.storageObject.findMany({
      where: { publicUrl: { in: removed }, status: 'ATTACHED' },
    });
    for (const row of detached) {
      await this.storage.delete(row.key);
      if (row.publicUrl !== row.key) {
        await this.storage.delete(row.publicUrl);
      }
    }
    if (detached.length) {
      await this.prisma.storageObject.updateMany({
        where: { id: { in: detached.map((row) => row.id) } },
        data: { status: 'ABORTED', listingId: null },
      });
    }
  }

  async sweepExpired() {
    const stale = await this.prisma.storageObject.findMany({
      where: {
        status: { in: ['PENDING', 'UPLOADED'] },
        expiresAt: { lt: new Date() },
      },
      take: 200,
    });

    for (const row of stale) {
      await this.storage.delete(row.key);
      if (row.publicUrl !== row.key) {
        await this.storage.delete(row.publicUrl);
      }
    }

    if (stale.length) {
      await this.prisma.storageObject.updateMany({
        where: { id: { in: stale.map((row) => row.id) } },
        data: { status: 'EXPIRED', listingId: null },
      });
    }

    return { swept: stale.length };
  }

  private async requireOwned(user: AuthUser, id: string) {
    const row = await this.prisma.storageObject.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('upload session not found');
    if (row.userId !== user.id) throw new ForbiddenException('not allowed');
    return row;
  }

  private toView(row: {
    id: string;
    key: string;
    publicUrl: string;
    status: string;
  }) {
    return {
      id: row.id,
      key: row.key,
      publicUrl: row.publicUrl,
      status: row.status,
    };
  }
}
