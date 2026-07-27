import nodemailer from "nodemailer";
import "dotenv/config";

interface SendEmailProps {
    from: string;
    to: string;
    subject: string;
    text: string;
    html?: string;
}

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST!,
    port: Number(process.env.SMTP_PORT!),
    secure: false,
    auth: {
        user: process.env.SENDER!,
        pass: process.env.BREVO_API_KEY!,
    },
});

export async function sendEmail(data: SendEmailProps) {
    const info = await transporter.sendMail({
        from: data.from,
        to: data.to,
        subject: data.subject,
        text: data.text,
        html: data.html,
    });

    console.log("Message sent:", info.messageId);
}

sendEmail({
    subject: "hello",
    from: '"Cloudisy" <team@cloudisy.com>',
    to: "frxmahadi@gmail.com",
    text: "hello",
}).catch(console.error);
