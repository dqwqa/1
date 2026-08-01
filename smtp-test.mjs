import process from 'node:process';
import nodemailer from 'nodemailer';

const user = process.env.SMTP_USER;
const pass = process.env.SMTP_AUTH_CODE;
const to = process.env.ALERT_EMAIL || user;

if (!user || !pass) {
  throw new Error('SMTP_USER 或 SMTP_AUTH_CODE 未配置');
}

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.163.com',
  port: Number(process.env.SMTP_PORT || 465),
  secure: String(process.env.SMTP_SECURE || 'true') !== 'false',
  auth: { user, pass },
});

await transporter.verify();
const info = await transporter.sendMail({
  from: user,
  to,
  subject: '洛克王国远行商人监控：无人值守邮件测试成功',
  text: [
    '你好！',
    '',
    '这是一封由 GitHub Actions 独立发送的测试邮件。',
    '收到这封邮件，说明 163 SMTP 授权码、无人值守运行环境和收件地址均配置成功。',
    '',
    '后续只有远行商人出现默认关注商品时才会发送商品提醒。',
  ].join('\n'),
});

console.log(JSON.stringify({ sent: true, to, messageId: info.messageId }));
