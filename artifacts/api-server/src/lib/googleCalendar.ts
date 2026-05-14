// Google Calendar via Replit Connectors
// Integration: connection:conn_google-calendar_01KN2247ETJPHW3J419VWBY2P3
import { google } from "googleapis";

let connectionSettings: {
  settings: {
    expires_at?: string;
    access_token?: string;
    oauth?: { credentials?: { access_token?: string } };
  };
} | null = null;

async function getAccessToken(): Promise<string> {
  if (
    connectionSettings &&
    connectionSettings.settings.expires_at &&
    new Date(connectionSettings.settings.expires_at).getTime() > Date.now()
  ) {
    return connectionSettings.settings.access_token ?? "";
  }

  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? "repl " + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
    ? "depl " + process.env.WEB_REPL_RENEWAL
    : null;

  if (!xReplitToken || !hostname) {
    throw new Error("Replit connector token not found");
  }

  const res = await fetch(
    `https://${hostname}/api/v2/connection?include_secrets=true&connector_names=google-calendar`,
    {
      headers: {
        Accept: "application/json",
        "X-Replit-Token": xReplitToken,
      },
    },
  );
  const data = (await res.json()) as { items?: typeof connectionSettings[] };
  connectionSettings = data.items?.[0] ?? null;

  const token =
    connectionSettings?.settings?.access_token ||
    connectionSettings?.settings?.oauth?.credentials?.access_token;

  if (!connectionSettings || !token) {
    throw new Error("Google Calendar not connected");
  }
  return token;
}

export async function getUncachableGoogleCalendarClient() {
  const accessToken = await getAccessToken();
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: accessToken });
  return google.calendar({ version: "v3", auth: oauth2Client });
}

export interface AppointmentData {
  title: string;
  description: string;
  startTime: string; // ISO 8601
  endTime: string;   // ISO 8601
  attendeeEmail?: string;
  location?: string;
}

export async function createCalendarEvent(data: AppointmentData) {
  const calendar = await getUncachableGoogleCalendarClient();
  const event = await calendar.events.insert({
    calendarId: "primary",
    requestBody: {
      summary: data.title,
      description: data.description,
      location: data.location ?? "ورشة غزالي للسيارات",
      start: { dateTime: data.startTime, timeZone: "Asia/Riyadh" },
      end: { dateTime: data.endTime, timeZone: "Asia/Riyadh" },
      attendees: data.attendeeEmail
        ? [{ email: data.attendeeEmail }]
        : [],
    },
  });
  return event.data;
}
