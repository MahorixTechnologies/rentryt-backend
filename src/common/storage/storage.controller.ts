import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';

import { AuthUserParam } from '../decorators/auth-user.decorator';
import { Roles } from '../decorators/roles.decorator';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { RolesGuard } from '../guards/roles.guard';
import type { AuthUser } from '../types/auth';
import { UserRole } from '../types/auth';

import { StorageUploadsService } from './storage-uploads.service';
import { MAX_UPLOAD_BYTES } from './storage.util';

type CreateUploadBody = {
  filename?: string;
  contentType?: string;
  purpose?: string;
};

@Controller('storage')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.LANDLORD, UserRole.ADMIN)
export class StorageController {
  constructor(private readonly uploads: StorageUploadsService) {}

  @Post('uploads')
  async createUpload(
    @AuthUserParam() user: AuthUser,
    @Body() body: CreateUploadBody,
    @Req() req: Request,
  ) {
    if (!body.contentType || !body.purpose) {
      throw new BadRequestException('contentType and purpose are required');
    }
    return this.uploads.createUpload(
      user,
      {
        filename: body.filename ?? '',
        contentType: body.contentType,
        purpose: body.purpose,
      },
      this.apiBase(req),
    );
  }

  @Post('uploads/:id/complete')
  async complete(@AuthUserParam() user: AuthUser, @Param('id') id: string) {
    return this.uploads.complete(user, id);
  }

  @Delete('uploads/:id')
  async abort(@AuthUserParam() user: AuthUser, @Param('id') id: string) {
    return this.uploads.abort(user, id);
  }

  @Put('local/:encodedKey')
  async putLocal(
    @AuthUserParam() user: AuthUser,
    @Param('encodedKey') encodedKey: string,
    @Req() req: Request,
  ) {
    const buffer = await readRawBody(req);
    const contentType = String(req.headers['content-type'] ?? '');
    return this.uploads.putLocal(user, encodedKey, buffer, contentType);
  }

  private apiBase(req: Request): string {
    const forwarded = req.headers['x-forwarded-proto'];
    const proto = typeof forwarded === 'string' ? forwarded.split(',')[0] : req.protocol;
    return `${proto}://${req.get('host')}`;
  }
}

async function readRawBody(req: Request): Promise<Buffer> {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body);
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > MAX_UPLOAD_BYTES) {
      throw new BadRequestException('file exceeds 5MB');
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}
