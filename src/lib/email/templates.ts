export type EmailContent = {
  subject: string;
  html: string;
  text: string;
};

export function verificationEmailTemplate(
  name: string,
  url: string,
): EmailContent {
  const recipientName = name ? name.split(" ")[0] : "there";
  const subject = "Verify your FlowPilot AI account";
  const text = `Hi ${recipientName},\n\nWelcome to FlowPilot AI! Please verify your email address by clicking the link below:\n\n${url}\n\nThis verification link expires in 24 hours. If you did not create an account, you can safely ignore this email.\n\n- The FlowPilot AI Team`;
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f7f7f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #292524;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding: 40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 540px; background-color: #ffffff; border-radius: 16px; border: 1px solid #e7e5e4; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
          <!-- Header -->
          <tr>
            <td style="padding: 32px 32px 24px 32px; background-color: #134e4a; color: #ffffff;">
              <h1 style="margin: 0; font-size: 22px; font-weight: 700; letter-spacing: -0.02em;">FlowPilot AI</h1>
              <p style="margin: 8px 0 0 0; font-size: 13px; color: #99f6e4;">Automation made thoughtful and durable</p>
            </td>
          </tr>
          <!-- Content -->
          <tr>
            <td style="padding: 36px 32px 24px 32px;">
              <h2 style="margin: 0 0 16px 0; font-size: 20px; font-weight: 600; color: #1c1917; letter-spacing: -0.02em;">Welcome aboard, ${recipientName}!</h2>
              <p style="margin: 0 0 24px 0; font-size: 15px; line-height: 1.6; color: #57534e;">
                Thank you for creating an account. Please confirm your email address so you can access your private workspace and start creating automations.
              </p>
              <table cellpadding="0" cellspacing="0" style="margin: 28px 0 32px 0;">
                <tr>
                  <td align="center" style="border-radius: 10px; background-color: #134e4a;">
                    <a href="${url}" target="_blank" style="display: inline-block; padding: 14px 28px; font-size: 14px; font-weight: 600; color: #ffffff; text-decoration: none; border-radius: 10px;">
                      Verify email address &rarr;
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin: 0 0 8px 0; font-size: 12px; color: #a8a29e;">
                Button not working? Copy and paste this link into your browser:
              </p>
              <p style="margin: 0; font-size: 12px; line-height: 1.5; color: #0d9488; word-break: break-all;">
                ${url}
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding: 24px 32px; background-color: #fafaf9; border-top: 1px solid #f5f5f4; font-size: 12px; color: #a8a29e; line-height: 1.5;">
              If you didn’t sign up for FlowPilot AI, you can safely ignore this email.<br>
              &copy; FlowPilot AI. All rights reserved.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, html, text };
}

export function resetPasswordEmailTemplate(
  name: string,
  url: string,
): EmailContent {
  const recipientName = name ? name.split(" ")[0] : "there";
  const subject = "Reset your FlowPilot AI password";
  const text = `Hi ${recipientName},\n\nWe received a request to reset your password for FlowPilot AI. Use the link below to choose a new password:\n\n${url}\n\nThis reset link expires in 1 hour. If you didn't request a password reset, you can safely ignore this email.\n\n- The FlowPilot AI Team`;
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f7f7f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #292524;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding: 40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 540px; background-color: #ffffff; border-radius: 16px; border: 1px solid #e7e5e4; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
          <!-- Header -->
          <tr>
            <td style="padding: 32px 32px 24px 32px; background-color: #134e4a; color: #ffffff;">
              <h1 style="margin: 0; font-size: 22px; font-weight: 700; letter-spacing: -0.02em;">FlowPilot AI</h1>
              <p style="margin: 8px 0 0 0; font-size: 13px; color: #99f6e4;">Password reset request</p>
            </td>
          </tr>
          <!-- Content -->
          <tr>
            <td style="padding: 36px 32px 24px 32px;">
              <h2 style="margin: 0 0 16px 0; font-size: 20px; font-weight: 600; color: #1c1917; letter-spacing: -0.02em;">Reset your password</h2>
              <p style="margin: 0 0 24px 0; font-size: 15px; line-height: 1.6; color: #57534e;">
                Hi ${recipientName}, we received a request to reset your password. Click the button below to set a new password:
              </p>
              <table cellpadding="0" cellspacing="0" style="margin: 28px 0 32px 0;">
                <tr>
                  <td align="center" style="border-radius: 10px; background-color: #134e4a;">
                    <a href="${url}" target="_blank" style="display: inline-block; padding: 14px 28px; font-size: 14px; font-weight: 600; color: #ffffff; text-decoration: none; border-radius: 10px;">
                      Reset password &rarr;
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin: 0 0 8px 0; font-size: 12px; color: #a8a29e;">
                This link will expire in 1 hour. If you didn't request this change, please ignore this email.
              </p>
              <p style="margin: 0; font-size: 12px; line-height: 1.5; color: #0d9488; word-break: break-all;">
                ${url}
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding: 24px 32px; background-color: #fafaf9; border-top: 1px solid #f5f5f4; font-size: 12px; color: #a8a29e; line-height: 1.5;">
              &copy; FlowPilot AI. Security notification.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, html, text };
}

