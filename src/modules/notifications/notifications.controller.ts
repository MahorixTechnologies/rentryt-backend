import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';

import { AuthUserParam } from '../../common/decorators/auth-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { AuthUser } from '../../common/types/auth';
import { PrismaService } from '../../prisma/prisma.service';

import { NotificationsService } from './notifications.service';

@Controller('users/me')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  @Get('notifications')
  async list(@AuthUserParam() user: AuthUser) {
    return await this.prisma.notification.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Patch('notifications/read-all')
  async markAllRead(@AuthUserParam() user: AuthUser) {
    return await this.notifications.markAllRead(user.id);
  }

  @Patch('notifications/:id/read')
  async markRead(@AuthUserParam() user: AuthUser, @Param('id') id: string) {
    const notification = await this.prisma.notification.findUnique({
      where: { id },
    });
    if (!notification || notification.userId !== user.id) {
      throw new NotFoundException('notification not found');
    }

    return await this.prisma.notification.update({
      where: { id },
      data: { read: true },
    });
  }

  @Post('device-tokens')
  async registerDeviceToken(
    @AuthUserParam() user: AuthUser,
    @Body() body: { token?: unknown; platform?: unknown },
  ) {
    const token = this.notifications.parseDeviceToken(body.token);
    const platform = this.notifications.parseDevicePlatform(body.platform);
    return await this.notifications.registerDeviceToken(user.id, token, platform);
  }

  @Delete('device-tokens')
  async unregisterDeviceToken(
    @AuthUserParam() user: AuthUser,
    @Body() body: { token?: unknown },
  ) {
    const token = this.notifications.parseDeviceToken(body.token);
    return await this.notifications.unregisterDeviceToken(user.id, token);
  }
}
