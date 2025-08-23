import nodemailer from 'nodemailer';
import { logger } from '@/utils/logger';

interface EmailConfig {
  from: string;
  replyTo?: string;
  appName: string;
  frontendUrl: string;
}

interface EmailTemplateData {
  firstName: string;
  [key: string]: any;
}

class EmailService {
  private transporter: nodemailer.Transporter | null = null;
  private config: EmailConfig;

  constructor() {
    this.config = {
      from: process.env['EMAIL_FROM'] || 'noreply@mappr.app',
      replyTo: process.env['EMAIL_REPLY_TO'] || 'support@mappr.app',
      appName: process.env['APP_NAME'] || 'Mappr Financial',
      frontendUrl: process.env['FRONTEND_URL'] || 'http://localhost:3001',
    };

    this.initializeTransporter();
  }

  private initializeTransporter() {
    try {
      if (process.env['NODE_ENV'] === 'production') {
        // Production email configuration
        if (process.env['SMTP_HOST'] && process.env['SMTP_USER'] && process.env['SMTP_PASS']) {
          this.transporter = nodemailer.createTransport({
            host: process.env['SMTP_HOST'],
            port: parseInt(process.env['SMTP_PORT'] || '587'),
            secure: process.env['SMTP_SECURE'] === 'true',
            auth: {
              user: process.env['SMTP_USER'],
              pass: process.env['SMTP_PASS'],
            },
            tls: {
              rejectUnauthorized: process.env['SMTP_TLS_REJECT_UNAUTHORIZED'] !== 'false',
            },
          });
        } else {
          logger.warn('SMTP configuration missing in production');
          this.transporter = null;
        }
      } else {
        // Development - use Ethereal Email for testing
        this.createEtherealTransporter();
      }

      if (this.transporter) {
        this.verifyConnection();
      }
    } catch (error) {
      logger.error('Failed to initialize email transporter:', error);
      this.transporter = null;
    }
  }

  private async createEtherealTransporter() {
    try {
      const testAccount = await nodemailer.createTestAccount();

      this.transporter = nodemailer.createTransport({
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false,
        auth: {
          user: testAccount.user,
          pass: testAccount.pass,
        },
      });

      logger.info('Development email transporter created with Ethereal Email');
      logger.info(`Test email account: ${testAccount.user}`);
    } catch (error) {
      logger.error('Failed to create Ethereal test account:', error);
      this.transporter = null;
    }
  }

  private async verifyConnection() {
    if (!this.transporter) return;

    try {
      await this.transporter.verify();
      logger.info('Email transporter connection verified');
    } catch (error) {
      logger.error('Email transporter verification failed:', error);
      this.transporter = null;
    }
  }

  private generateEmailTemplate(
    subject: string,
    title: string,
    content: string,
    buttonText?: string,
    buttonUrl?: string
  ): string {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${subject}</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f7f9fc;
        }
        .container {
            background-color: #ffffff;
            padding: 40px;
            border-radius: 12px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        }
        .logo {
            text-align: center;
            margin-bottom: 30px;
        }
        .logo h1 {
            color: #1f2937;
            margin: 0;
            font-size: 28px;
            font-weight: 700;
        }
        .content {
            margin-bottom: 30px;
        }
        .button {
            display: inline-block;
            background-color: #3b82f6;
            color: white;
            padding: 12px 24px;
            text-decoration: none;
            border-radius: 8px;
            font-weight: 500;
            margin: 20px 0;
            text-align: center;
        }
        .button:hover {
            background-color: #2563eb;
        }
        .footer {
            margin-top: 40px;
            padding-top: 20px;
            border-top: 1px solid #e5e7eb;
            font-size: 14px;
            color: #6b7280;
            text-align: center;
        }
        .security-notice {
            background-color: #fef3c7;
            border: 1px solid #f59e0b;
            padding: 15px;
            border-radius: 8px;
            margin: 20px 0;
            font-size: 14px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="logo">
            <h1>${this.config.appName}</h1>
        </div>
        
        <h2 style="color: #1f2937; margin-bottom: 20px;">${title}</h2>
        
        <div class="content">
            ${content}
        </div>
        
        ${
          buttonText && buttonUrl
            ? `
        <div style="text-align: center;">
            <a href="${buttonUrl}" class="button">${buttonText}</a>
        </div>
        `
            : ''
        }
        
        <div class="security-notice">
            <strong>Security Notice:</strong> If you didn't request this action, please ignore this email or contact our support team immediately.
        </div>
        
        <div class="footer">
            <p>This email was sent by ${this.config.appName}<br>
            If you have questions, reply to this email or contact us at ${this.config.replyTo}</p>
        </div>
    </div>
</body>
</html>
    `;
  }

  async sendPasswordResetEmail(
    email: string,
    data: EmailTemplateData & { resetUrl: string }
  ): Promise<boolean> {
    if (!this.transporter) {
      logger.error('Email transporter not available for password reset');
      return false;
    }

    try {
      const subject = 'Reset Your Password';
      const title = 'Password Reset Request';
      const content = `
        <p>Hi ${data.firstName},</p>
        <p>We received a request to reset the password for your ${this.config.appName} account.</p>
        <p>Click the button below to reset your password. This link will expire in 1 hour for security reasons.</p>
      `;

      const html = this.generateEmailTemplate(
        subject,
        title,
        content,
        'Reset Password',
        data.resetUrl
      );

      const info = await this.transporter.sendMail({
        from: this.config.from,
        to: email,
        subject,
        html,
        replyTo: this.config.replyTo,
      });

      logger.info(`Password reset email sent to ${email}`, { messageId: info.messageId });

      if (process.env['NODE_ENV'] !== 'production') {
        logger.info(`Preview URL: ${nodemailer.getTestMessageUrl(info)}`);
      }

      return true;
    } catch (error) {
      logger.error('Failed to send password reset email:', error);
      return false;
    }
  }

  async sendEmailVerificationEmail(
    email: string,
    data: EmailTemplateData & { verificationUrl: string }
  ): Promise<boolean> {
    if (!this.transporter) {
      logger.error('Email transporter not available for email verification');
      return false;
    }

    try {
      const subject = 'Verify Your Email Address';
      const title = 'Welcome to Mappr Financial!';
      const content = `
        <p>Hi ${data.firstName},</p>
        <p>Thank you for creating an account with ${this.config.appName}!</p>
        <p>To complete your registration and secure your account, please verify your email address by clicking the button below.</p>
        <p>This verification link will expire in 24 hours.</p>
      `;

      const html = this.generateEmailTemplate(
        subject,
        title,
        content,
        'Verify Email Address',
        data.verificationUrl
      );

      const info = await this.transporter.sendMail({
        from: this.config.from,
        to: email,
        subject,
        html,
        replyTo: this.config.replyTo,
      });

      logger.info(`Email verification sent to ${email}`, { messageId: info.messageId });

      if (process.env['NODE_ENV'] !== 'production') {
        logger.info(`Preview URL: ${nodemailer.getTestMessageUrl(info)}`);
      }

      return true;
    } catch (error) {
      logger.error('Failed to send email verification:', error);
      return false;
    }
  }

  async sendWelcomeEmail(email: string, data: EmailTemplateData): Promise<boolean> {
    if (!this.transporter) {
      logger.error('Email transporter not available for welcome email');
      return false;
    }

    try {
      const subject = `Welcome to ${this.config.appName}!`;
      const title = 'Your Account is Ready!';
      const content = `
        <p>Hi ${data.firstName},</p>
        <p>Welcome to ${this.config.appName}! Your account has been successfully verified and you're ready to start managing your finances with AI-powered insights.</p>
        <p>Here's what you can do next:</p>
        <ul>
          <li>Connect your bank accounts securely</li>
          <li>Set up your first budget</li>
          <li>Explore AI-powered financial insights</li>
          <li>Track your expenses automatically</li>
        </ul>
        <p>If you have any questions, don't hesitate to reach out to our support team.</p>
      `;

      const html = this.generateEmailTemplate(
        subject,
        title,
        content,
        'Get Started',
        `${this.config.frontendUrl}/dashboard`
      );

      const info = await this.transporter.sendMail({
        from: this.config.from,
        to: email,
        subject,
        html,
        replyTo: this.config.replyTo,
      });

      logger.info(`Welcome email sent to ${email}`, { messageId: info.messageId });

      if (process.env['NODE_ENV'] !== 'production') {
        logger.info(`Preview URL: ${nodemailer.getTestMessageUrl(info)}`);
      }

      return true;
    } catch (error) {
      logger.error('Failed to send welcome email:', error);
      return false;
    }
  }

  async sendTwoFactorSetupEmail(email: string, data: EmailTemplateData): Promise<boolean> {
    if (!this.transporter) {
      logger.error('Email transporter not available for 2FA setup email');
      return false;
    }

    try {
      const subject = 'Two-Factor Authentication Enabled';
      const title = 'Your Account is More Secure!';
      const content = `
        <p>Hi ${data.firstName},</p>
        <p>Two-factor authentication has been successfully enabled for your ${this.config.appName} account.</p>
        <p>Your account is now protected with an additional layer of security. You'll need your authenticator app to sign in going forward.</p>
        <p>If you didn't enable this feature, please contact our support team immediately.</p>
      `;

      const html = this.generateEmailTemplate(subject, title, content);

      const info = await this.transporter.sendMail({
        from: this.config.from,
        to: email,
        subject,
        html,
        replyTo: this.config.replyTo,
      });

      logger.info(`2FA setup email sent to ${email}`, { messageId: info.messageId });

      if (process.env['NODE_ENV'] !== 'production') {
        logger.info(`Preview URL: ${nodemailer.getTestMessageUrl(info)}`);
      }

      return true;
    } catch (error) {
      logger.error('Failed to send 2FA setup email:', error);
      return false;
    }
  }

  async testConnection(): Promise<boolean> {
    if (!this.transporter) {
      logger.error('Email transporter not available for testing');
      return false;
    }

    try {
      await this.transporter.verify();
      logger.info('Email service connection test successful');
      return true;
    } catch (error) {
      logger.error('Email service connection test failed:', error);
      return false;
    }
  }
}

export const emailService = new EmailService();
export { EmailService };
