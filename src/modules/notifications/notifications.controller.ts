import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  UseGuards,
} from '@nestjs/common';

import { AuthUserParam } from '../../common/decorators/auth-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { AuthUser } from '../../common/types/auth';
import { PrismaService } from '../../prisma/prisma.service';

@Controller('users/me/notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@AuthUserParam() user: AuthUser) {
    return await this.prisma.notification.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Patch(':id/read')
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
}
