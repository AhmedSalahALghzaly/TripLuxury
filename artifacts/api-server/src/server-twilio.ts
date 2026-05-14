import { clog } from "./lib/console-shim";
/**
 * Twilio SMS Service - graceful stub
 * Will work when Twilio connector is configured
 */

const verificationCodes = new Map<string, { code: string; expires: number; attempts: number }>();

export async function sendVerificationCode(phone: string): Promise<{ success: boolean; error?: string }> {
  try {
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expires = Date.now() + 10 * 60 * 1000;
    verificationCodes.set(phone, { code, expires, attempts: 0 });
    clog.info(`[SMS] Verification code for ${phone}: ${code}`);
    return { success: true };
  } catch (error: any) {
    clog.error('Twilio send error:', error.message);
    return { success: false, error: error.message };
  }
}

export function verifyCode(phone: string, code: string): { valid: boolean; error?: string } {
  const record = verificationCodes.get(phone);
  if (!record) return { valid: false, error: 'No verification code sent to this number' };
  if (Date.now() > record.expires) {
    verificationCodes.delete(phone);
    return { valid: false, error: 'Verification code expired' };
  }
  record.attempts += 1;
  if (record.attempts > 5) {
    verificationCodes.delete(phone);
    return { valid: false, error: 'Too many attempts' };
  }
  if (record.code !== code) return { valid: false, error: 'Invalid verification code' };
  verificationCodes.delete(phone);
  return { valid: true };
}
