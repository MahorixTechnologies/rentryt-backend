import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync, readFileSync } from 'fs';
import {
  cert,
  getApps,
  initializeApp,
  type App,
  type Credential,
  type ServiceAccount,
} from 'firebase-admin/app';
import { getMessaging, type Messaging } from 'firebase-admin/messaging';

import type { PushProviderAdapter, PushSendParams, PushSendResult } from './push-provider.interface';

const STALE_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

@Injectable()
export class FirebasePushProvider implements PushProviderAdapter {
  private readonly logger = new Logger(FirebasePushProvider.name);
  private app: App | null | undefined;

  constructor(private readonly config: ConfigService) {}

  async send(params: PushSendParams): Promise<PushSendResult> {
    const tokens = [...new Set(params.tokens.filter(Boolean))];
    if (tokens.length === 0) {
      return { invalidTokens: [] };
    }

    const messaging = this.getMessaging();
    if (!messaging) {
      this.logger.log(
        `push skipped (firebase not configured) title="${params.title}" tokens=${tokens.length}`,
      );
      return { invalidTokens: [] };
    }

    const response = await messaging.sendEachForMulticast({
      tokens,
      notification: {
        title: params.title,
        body: params.body,
      },
      data: params.data,
      android: {
        priority: 'high',
        notification: {
          channelId: 'default',
          sound: 'default',
        },
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
          },
        },
      },
    });

    const invalidTokens: string[] = [];
    response.responses.forEach((result, index) => {
      if (result.success) return;
      const code = result.error?.code ?? '';
      const token = tokens[index];
      if (token && STALE_TOKEN_CODES.has(code)) {
        invalidTokens.push(token);
        return;
      }
      this.logger.warn(
        `fcm send failed token=${token?.slice(0, 12)}… code=${code} ${result.error?.message ?? ''}`.trim(),
      );
    });

    return { invalidTokens };
  }

  private getMessaging(): Messaging | null {
    const app = this.getApp();
    return app ? getMessaging(app) : null;
  }

  private getApp(): App | null {
    if (this.app !== undefined) return this.app;

    const existing = getApps()[0];
    if (existing) {
      this.app = existing;
      return existing;
    }

    const credential = this.loadCredential();
    if (!credential) {
      this.app = null;
      return null;
    }

    this.app = initializeApp({ credential });
    return this.app;
  }

  private loadCredential(): Credential | null {
    const raw = this.config.get<string>('FIREBASE_SERVICE_ACCOUNT_JSON');
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as ServiceAccount;
        return cert(parsed);
      } catch (err) {
        this.logger.error(
          `invalid FIREBASE_SERVICE_ACCOUNT_JSON: ${err instanceof Error ? err.message : String(err)}`,
        );
        return null;
      }
    }

    const filePath = this.config.get<string>('FIREBASE_SERVICE_ACCOUNT_PATH');
    if (filePath && existsSync(filePath)) {
      try {
        const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as ServiceAccount;
        return cert(parsed);
      } catch (err) {
        this.logger.error(
          `invalid FIREBASE_SERVICE_ACCOUNT_PATH: ${err instanceof Error ? err.message : String(err)}`,
        );
        return null;
      }
    }

    return null;
  }
}
