import nodemailer from "nodemailer";
import {
  verificationEmailTemplate,
  resetPasswordEmailTemplate,
  type EmailContent,
} from "./templates";

export type SendEmailOptions = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export function isEmailConfigured(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return Boolean(env.RESEND_API_KEY || env.SMTP_URL || env.SMTP_HOST);
}

export function getFromAddress(
  env: Record<string, string | undefined> = process.env,
): string {
  return env.EMAIL_FROM || "FlowPilot AI <no-reply@flowpilot.ai>";
}

export async function sendEmail(
  options: SendEmailOptions,
  env: Record<string, string | undefined> = process.env,
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const from = getFromAddress(env);

  // 1. Resend Provider
  if (env.RESEND_API_KEY) {
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: [options.to],
          subject: options.subject,
          html: options.html,
          text: options.text,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("[Email Dispatcher] Resend API error:", errorText);
        return { success: false, error: `Resend error: ${response.status}` };
      }

      const data = (await response.json()) as { id?: string };
      return { success: true, messageId: data.id };
    } catch (err) {
      console.error("[Email Dispatcher] Resend fetch failed:", err);
      return { success: false, error: "Resend connection failed" };
    }
  }

  // 2. SMTP Provider (Nodemailer)
  if (env.SMTP_URL || env.SMTP_HOST) {
    try {
      const transportConfig = env.SMTP_URL
        ? env.SMTP_URL
        : {
            host: env.SMTP_HOST,
            port: Number(env.SMTP_PORT || 587),
            secure: env.SMTP_SECURE === "true" || env.SMTP_PORT === "465",
            auth: {
              user: env.SMTP_USER || "",
              pass: env.SMTP_PASS || "",
            },
          };

      const transporter = nodemailer.createTransport(transportConfig);
      const info = await transporter.sendMail({
        from,
        to: options.to,
        subject: options.subject,
        text: options.text,
        html: options.html,
      });

      return { success: true, messageId: info.messageId };
    } catch (err) {
      console.error("[Email Dispatcher] SMTP send failed:", err);
      return { success: false, error: "SMTP transmission failed" };
    }
  }

  // 3. Development / Local Fallback Mode
  console.log("------------------------------------------------------------");
  console.log(`[Email Dispatcher - Dev/Test Mode]`);
  console.log(`To: ${options.to}`);
  console.log(`Subject: ${options.subject}`);
  console.log(`Body (Plain Text):\n${options.text}`);
  console.log("------------------------------------------------------------");

  return { success: true, messageId: "dev-simulated-id" };
}

export async function sendUserVerificationEmail(
  user: { name?: string | null; email: string },
  url: string,
  env: Record<string, string | undefined> = process.env,
) {
  const content = verificationEmailTemplate(user.name || "", url);
  return sendEmail(
    {
      to: user.email,
      subject: content.subject,
      html: content.html,
      text: content.text,
    },
    env,
  );
}

export async function sendUserPasswordResetEmail(
  user: { name?: string | null; email: string },
  url: string,
  env: Record<string, string | undefined> = process.env,
) {
  const content = resetPasswordEmailTemplate(user.name || "", url);
  return sendEmail(
    {
      to: user.email,
      subject: content.subject,
      html: content.html,
      text: content.text,
    },
    env,
  );
}
