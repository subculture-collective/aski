export interface SignInMail { email: string; url: string }
export interface Mailer { send(mail: SignInMail): Promise<void> }
export function brevoMailer(key: string, sender: string, transport: typeof fetch = fetch): Mailer {
  if (!key || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sender)) throw new Error('Mail configuration unavailable');
  return { async send({ email, url }) {
    const response = await transport('https://api.brevo.com/v3/smtp/email', {
      method: 'POST', headers: { 'api-key': key, 'content-type': 'application/json', accept: 'application/json' },
      signal: AbortSignal.timeout(10_000), redirect: 'error',
      body: JSON.stringify({ sender: { name: 'aski', email: sender }, to: [{ email }], subject: 'Your aski sign-in link', textContent: `Continue to aski:\n${url}\n\nThis link expires in 10 minutes. If you did not request it, ignore this message.` }),
    });
    if (!response.ok) throw new Error('Mail unavailable');
  } };
}
