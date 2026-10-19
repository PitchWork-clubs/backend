export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

export interface IEmailProvider {
  sendEmail(message: EmailMessage): Promise<void>;
}

export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');
