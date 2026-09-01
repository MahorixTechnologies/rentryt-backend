import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';

/**
 * Guards Vercel Cron HTTP endpoints (src/modules/cron).
 *
 * Vercel's documented convention: when a `CRON_SECRET` env var is set on the
 * project, Vercel automatically attaches `Authorization: Bearer <CRON_SECRET>`
 * to every request it makes to the paths configured in `vercel.json`'s
 * `"crons"` array. Checking for that exact header is therefore sufficient to
 * ensure only Vercel's own scheduler (or someone who knows the secret) can
 * trigger these endpoints — no user session is involved, so this guard is
 * used standalone (no JwtAuthGuard/RolesGuard).
 *
 * Rejects (401) if CRON_SECRET isn't configured at all, since an empty/unset
 * secret must never be treated as "no auth required".
 */
@Injectable()
export class CronSecretGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const secret = process.env.CRON_SECRET;
    if (!secret) {
      throw new UnauthorizedException('CRON_SECRET is not configured');
    }

    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers['authorization'];

    if (header !== `Bearer ${secret}`) {
      throw new UnauthorizedException('Invalid or missing cron secret');
    }

    return true;
  }
}
