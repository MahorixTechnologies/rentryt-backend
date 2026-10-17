export const PUSH_PROVIDER = Symbol('PUSH_PROVIDER');

export type PushSendParams = {
  tokens: string[];
  title: string;
  body: string;
  data?: Record<string, string>;
};

export type PushSendResult = {
  invalidTokens: string[];
};

export interface PushProviderAdapter {
  send(params: PushSendParams): Promise<PushSendResult>;
}
