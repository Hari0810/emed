import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  PUBLIC_BASE_URL: z.string().url().default("http://localhost:3000"),
  RUNWARE_API_KEY: z.string().optional(),
  RUNWARE_MODEL: z.string().default("deepseek:v4@flash"),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_PHONE_NUMBER: z.string().optional(),
  SKIP_TWILIO_SIGNATURE_VALIDATION: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  EMERGENCY_NUMBER: z.string().default("999")
});

const parsed = schema.parse(process.env);

export const config = {
  ...parsed,
  publicBaseUrl: parsed.PUBLIC_BASE_URL.replace(/\/$/, ""),
  websocketBaseUrl: parsed.PUBLIC_BASE_URL.replace(/^http/, "ws").replace(/\/$/, "")
};

export function hasTwilioCredentials() {
  return Boolean(
    config.TWILIO_ACCOUNT_SID &&
      config.TWILIO_AUTH_TOKEN &&
      config.TWILIO_PHONE_NUMBER
  );
}
