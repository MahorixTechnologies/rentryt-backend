import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import type { AuthUser } from '../types/auth';
import { UserRole } from '../types/auth';

type JwtPayload = { sub: string; email: string; role: UserRole };

/**
 * Best-effort viewer identity for endpoints that stay public either way
 * (anonymous browsing must keep working) but want to know who's asking —
 * e.g. to let a demo account see the seeded catalogue, or a signed-in admin
 * see something a guest wouldn't. Never throws: a missing/expired/invalid
 * token is treated the same as no token. Extracted from ListingsController
 * (its original home) since GET /search needs the exact same behavior.
 */
@Injectable()
export class OptionalViewerService {
  constructor(private readonly jwt: JwtService) {}

  async decode(authHeader?: string): Promise<AuthUser | null> {
    const token = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) return null;
    try {
      const payload = await this.jwt.verifyAsync<JwtPayload>(token);
      return { id: payload.sub, email: payload.email, role: payload.role };
    } catch {
      return null;
    }
  }
}
