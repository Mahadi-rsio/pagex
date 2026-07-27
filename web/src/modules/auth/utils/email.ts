import nodemailer from "nodemailer";

interface SendEmailProps {
    from: string;
    to: string;
    subject: string;
    text: string;
    html?: string;
}

interface SmtpConfig {
    host: string;
    port: number;
    user: string;
    pass: string;
}

export async function sendEmail(data: SendEmailProps, smtp: SmtpConfig) {
    const transporter = nodemailer.createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: false,
        auth: {
            user: smtp.user,
            pass: smtp.pass,
        },
    });

    const info = await transporter.sendMail(data);
    console.log("Message sent:", info.messageId);
}

export function getOtpEmailHtml(otp: string): string {
    return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:2rem 1rem;">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e4e4e7;">
        <tr>
          <td style="background:#1a1a1a;padding:1.25rem 2rem;">
            <span style="color:#ffffff;font-size:16px;font-weight:500;">Cloudisy</span>
          </td>
        </tr>
        <tr>
          <td style="padding:2rem;">
            <p style="font-size:15px;color:#18181b;margin:0 0 0.5rem;">Hi there,</p>
            <p style="font-size:15px;color:#71717a;margin:0 0 1.75rem;line-height:1.6;">
              Use the code below to verify your email address. It expires in
              <strong style="color:#18181b;">10 minutes</strong>.
            </p>
            <div style="background:#f4f4f5;border-radius:8px;padding:1.25rem;text-align:center;margin:0 0 1.75rem;border:1px solid #e4e4e7;">
              <span style="font-family:monospace;font-size:32px;font-weight:500;letter-spacing:0.25em;color:#18181b;">
                ${otp}
              </span>
            </div>
            <p style="font-size:13px;color:#a1a1aa;margin:0;line-height:1.6;">
              If you didn't request this, you can safely ignore this email.
            </p>
          </td>
        </tr>
        <tr>
          <td style="border-top:1px solid #e4e4e7;padding:1rem 2rem;display:flex;justify-content:space-between;">
            <span style="font-size:12px;color:#a1a1aa;">© 2026 Cloudisy</span>
            &nbsp;&nbsp;
            <span style="font-size:12px;color:#a1a1aa;">team@cloudisy.com</span>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
