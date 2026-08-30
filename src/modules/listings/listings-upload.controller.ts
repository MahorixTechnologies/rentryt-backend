import {
  BadRequestException,
  Controller,
  Inject,
  Param,
  Post,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';

import { AuthUserParam } from '../../common/decorators/auth-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { STORAGE_SERVICE, type StorageService } from '../../common/storage/storage.interface';
import type { AuthUser } from '../../common/types/auth';
import { UserRole } from '../../common/types/auth';

import { ListingsService } from './listings.service';

const MAX_FILES = 6;
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

@Controller('listings')
export class ListingsUploadController {
  constructor(
    private readonly listings: ListingsService,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
  ) {}

  @Post(':id/images')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.LANDLORD, UserRole.ADMIN)
  @UseInterceptors(
    FilesInterceptor('files', MAX_FILES, {
      limits: { fileSize: MAX_FILE_SIZE_BYTES },
      fileFilter: (_req, file, callback) => {
        callback(null, ALLOWED_MIME_TYPES.has(file.mimetype));
      },
    }),
  )
  async uploadImages(
    @AuthUserParam() user: AuthUser,
    @Param('id') id: string,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    if (!files?.length) {
      throw new BadRequestException('at least one image file is required (jpeg, png, or webp)');
    }

    const urls = await Promise.all(files.map((file) => this.storage.upload(file)));
    return await this.listings.appendImages(user, id, urls);
  }
}
