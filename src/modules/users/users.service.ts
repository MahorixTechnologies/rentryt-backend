import { BadRequestException, Injectable } from '@nestjs/common';
import type { IdentityDocumentType } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

function last4(value: string): string {
  const digits = value.replace(/\s+/g, '');
  return digits.slice(-4);
}

function validateIdentity(
  documentType: IdentityDocumentType,
  documentNumber: string,
) {
  const normalized = documentNumber.replace(/\s+/g, '');
  if (documentType === 'NIN') {
    if (!/^\d{11}$/.test(normalized)) {
      throw new BadRequestException('NIN must be 11 digits');
    }
    return normalized;
  }
  if (normalized.length < 6) {
    throw new BadRequestException('valid ID number is too short');
  }
  return normalized;
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async submitIdentity(
    userId: string,
    params: { documentType: IdentityDocumentType; documentNumber: string },
  ) {
    const normalized = validateIdentity(
      params.documentType,
      params.documentNumber,
    );

    return await this.prisma.user.update({
      where: { id: userId },
      data: {
        identityDocumentType: params.documentType,
        identityDocumentLast4: last4(normalized),
        identityVerified: true,
      },
      select: {
        id: true,
        email: true,
        identityDocumentType: true,
        identityDocumentLast4: true,
        identityVerified: true,
        phoneVerified: true,
        emailVerified: true,
      },
    });
  }
}
