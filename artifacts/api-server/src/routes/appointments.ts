import { Router, Request, Response } from "express";
import { z } from "zod";
import { query } from "../server-db";
import { requireAuth, getCurrentUser, getUserRole, getPrivilegedUserIds } from "../server-auth";
import { randomUUID } from "node:crypto";
import { createCalendarEvent } from "../lib/googleCalendar";
import { broadcastToUser, broadcastToUsers } from "../server-routes";
import { doAutoReply } from "./chat";

const createAppointmentSchema = z.object({
  service_type: z.string().min(1).default("maintenance"),
  car_info: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  appointment_date: z.string().min(1, "appointment_date is required"),
  duration_minutes: z.number().int().positive().default(60),
  user_name: z.string().optional().nullable(),
  user_phone: z.string().optional().nullable(),
  restaurant_id: z.string().uuid("restaurant_id must be a valid UUID"),
});

export function createAppointmentsRouter(): Router {
  const router = Router();

  // Ensure table exists
  query(`
    CREATE TABLE IF NOT EXISTS appointments (
      id VARCHAR(36) PRIMARY KEY,
      user_id VARCHAR(36),
      user_name VARCHAR(255),
      user_email VARCHAR(255),
      user_phone VARCHAR(50),
      service_type VARCHAR(100) NOT NULL DEFAULT 'maintenance',
      car_info VARCHAR(255),
      notes TEXT,
      appointment_date TIMESTAMPTZ NOT NULL,
      duration_minutes INTEGER NOT NULL DEFAULT 60,
      status VARCHAR(50) NOT NULL DEFAULT 'pending',
      calendar_event_id VARCHAR(255),
      restaurant_id UUID NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `).catch(() => {});
  // Add restaurant_id column to existing tables (idempotent). NOT NULL is
  // enforced once `scripts/src/backfill-appointment-restaurants.ts` has
  // populated legacy rows, so we only add the nullable column here and let
  // the backfill script tighten the constraint.
  query(`ALTER TABLE appointments ADD COLUMN IF NOT EXISTS restaurant_id UUID`).catch(() => {});
  query(`CREATE INDEX IF NOT EXISTS idx_appt_restaurant ON appointments (restaurant_id)`).catch(() => {});
  // Add tables_count to car_models for per-restaurant configuration
  query(`ALTER TABLE car_models ADD COLUMN IF NOT EXISTS tables_count INTEGER DEFAULT 12`).catch(() => {});

  // Audit log of all appointment changes (reschedule / status / delete)
  query(`
    CREATE TABLE IF NOT EXISTS appointment_history (
      id VARCHAR(36) PRIMARY KEY,
      appointment_id VARCHAR(36) NOT NULL,
      action VARCHAR(50) NOT NULL,
      actor_id VARCHAR(36),
      actor_name VARCHAR(255),
      actor_email VARCHAR(255),
      old_values JSONB,
      new_values JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `).catch(() => {});
  query(
    `CREATE INDEX IF NOT EXISTS idx_appointment_history_appt
       ON appointment_history(appointment_id, created_at DESC)`,
  ).catch(() => {});

  const isPrivilegedRole = (role: string) =>
    role === "admin" || role === "owner" || role === "partner";

  const recordHistory = async (params: {
    appointmentId: string;
    action: "rescheduled" | "status_changed" | "deleted";
    actor: { id?: string | null; name?: string | null; email?: string | null };
    oldValues: Record<string, any> | null;
    newValues: Record<string, any> | null;
  }) => {
    try {
      await query(
        `INSERT INTO appointment_history
           (id, appointment_id, action, actor_id, actor_name, actor_email, old_values, new_values)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          randomUUID(),
          params.appointmentId,
          params.action,
          params.actor.id || null,
          params.actor.name || null,
          params.actor.email || null,
          params.oldValues ? JSON.stringify(params.oldValues) : null,
          params.newValues ? JSON.stringify(params.newValues) : null,
        ],
      );
    } catch (_err) {
      // Audit logging is best-effort; never block the main op.
    }
  };

  // GET /api/appointments — list appointments
  router.get("/", requireAuth as any, async (req: Request, res: Response) => {
    try {
      const user = await getCurrentUser(req);
      if (!user) return res.status(401).json({ detail: "Unauthorized" });
      const role = await getUserRole(user.email);

      // Join car_models (legacy table that holds restaurants) so the client
      // can render restaurant_name without a second roundtrip. Selecting a.*
      // preserves all existing fields; we add restaurant_name / restaurant_name_ar
      // alongside.
      let rows;
      if (isPrivilegedRole(role)) {
        rows = await query(
          `SELECT a.*,
                  cm.name    AS restaurant_name,
                  cm.name_ar AS restaurant_name_ar
             FROM appointments a
             LEFT JOIN car_models cm ON cm.id = a.restaurant_id
            ORDER BY a.appointment_date ASC`,
        );
      } else {
        rows = await query(
          `SELECT a.*,
                  cm.name    AS restaurant_name,
                  cm.name_ar AS restaurant_name_ar
             FROM appointments a
             LEFT JOIN car_models cm ON cm.id = a.restaurant_id
            WHERE a.user_id = $1
            ORDER BY a.appointment_date ASC`,
          [user.id],
        );
      }
      return res.json({ appointments: rows.rows });
    } catch (err: any) {
      return res.status(500).json({ detail: err.message });
    }
  });

  // POST /api/appointments — create appointment
  router.post("/", requireAuth as any, async (req: Request, res: Response) => {
    try {
      const user = await getCurrentUser(req);
      if (!user) return res.status(401).json({ detail: "Unauthorized" });

      const parsed = createAppointmentSchema.safeParse(req.body);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        return res.status(400).json({
          detail: issue ? `${issue.path.join(".") || "body"}: ${issue.message}` : "Invalid request body",
          errors: parsed.error.issues,
        });
      }
      const {
        service_type,
        car_info,
        notes,
        appointment_date,
        duration_minutes,
        user_name,
        user_phone,
        restaurant_id,
      } = parsed.data;

      const id = randomUUID();
      const startTime = new Date(appointment_date).toISOString();
      const endTime = new Date(
        new Date(appointment_date).getTime() + duration_minutes * 60000,
      ).toISOString();

      let calendarEventId: string | null = null;
      try {
        const calEvent = await createCalendarEvent({
          title: `حجز طاولة${service_type?.startsWith("table_") ? ` ${service_type.replace("table_", "")}` : ""} — ${user_name || user.name || user.email}`,
          description: `${car_info ? `الصالة: ${car_info}\n` : ""}${notes ? `ملاحظات: ${notes}` : ""}`,
          startTime,
          endTime,
          attendeeEmail: user.email ?? undefined,
          location: "مطعم الغزالي — Al-Ghazaly Dining",
        });
        calendarEventId = calEvent.id ?? null;
      } catch (_err) {
        // Google Calendar optional — continue without it
      }

      const result = await query(
        `INSERT INTO appointments
          (id, user_id, user_name, user_email, user_phone, service_type, car_info, notes,
           appointment_date, duration_minutes, status, calendar_event_id, restaurant_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending',$11,$12) RETURNING *`,
        [
          id,
          user.id,
          user_name || user.name || "",
          user.email || "",
          user_phone || "",
          service_type,
          car_info || "",
          notes || "",
          appointment_date,
          duration_minutes,
          calendarEventId,
          restaurant_id,
        ],
      );

      // Insert a confirmation notification for the customer
      try {
        const tableNum = service_type?.startsWith("table_") ? service_type.replace("table_", "") : null;
        const hallInfo = car_info ? ` — ${car_info}` : "";
        const serviceLabelAr = tableNum ? `حجز طاولة ${tableNum}${hallInfo}` : "حجز طاولة";
        const serviceLabelEn = tableNum ? `Table ${tableNum} Reservation${car_info ? ` — ${car_info}` : ""}` : "Table Reservation";
        const apptDate = new Date(appointment_date);
        // Cairo (UTC+02:00) — workshop's operating timezone
        const tz = "Africa/Cairo";
        const dateLabelAr = apptDate.toLocaleDateString("ar-EG", {
          weekday: "long",
          day: "numeric",
          month: "long",
          year: "numeric",
          timeZone: tz,
        });
        const dateLabelEn = apptDate.toLocaleDateString("en-US", {
          weekday: "long",
          day: "numeric",
          month: "long",
          year: "numeric",
          timeZone: tz,
        });
        const timeLabel = apptDate.toLocaleTimeString("en-GB", {
          hour: "2-digit",
          minute: "2-digit",
          timeZone: tz,
        });
        const metadata = {
          kind: "appointment_confirmed",
          appointment_id: id,
          appointment_date,
          service_type,
          car_info: car_info || "",
          notes: notes || "",
          customer_name: user_name || user.name || "",
          customer_phone: user_phone || "",
          customer_email: user.email || "",
        };
        await query(
          `INSERT INTO notifications (id, user_id, title, title_ar, message, message_ar, type, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, 'success', $7)`,
          [
            randomUUID(),
            user.id,
            `Appointment Confirmed`,
            `تم تأكيد موعدك`,
            `Your ${serviceLabelEn} appointment is booked for ${dateLabelEn} at ${timeLabel}.`,
            `تم حجز موعد ${serviceLabelAr} يوم ${dateLabelAr} الساعة ${timeLabel}.`,
            JSON.stringify(metadata),
          ],
        );

        // Fan out to privileged users (owner / admin / partner) so they're
        // alerted in their bell tray about the new booking.
        try {
          const customerName = user_name || user.name || "";
          const customerPhone = user_phone || "";
          const carInfo = car_info || "";
          const adminTitleEn = "New Appointment Booked";
          const adminTitleAr = "حجز موعد جديد";
          const adminMsgEn =
            `${customerName || "A customer"} booked ${serviceLabelEn} for ${dateLabelEn} at ${timeLabel}` +
            `${carInfo ? ` — ${carInfo}` : ""}` +
            `${customerPhone ? ` (${customerPhone})` : ""}.`;
          const adminMsgAr =
            `${customerName || "عميل"} قام بحجز ${serviceLabelAr} يوم ${dateLabelAr} الساعة ${timeLabel}` +
            `${carInfo ? ` — ${carInfo}` : ""}` +
            `${customerPhone ? ` (${customerPhone})` : ""}.`;

          const privilegedIds = await getPrivilegedUserIds(user.id);

          // Distinct metadata for the admin/owner side: when they tap
          // "view details" we want to land on the *customer's* cart →
          // orders tab, not the admin's own. The customer's metadata
          // above keeps `kind: "appointment_confirmed"` so their tap
          // still routes to their own cart.
          const adminMetadata = {
            ...metadata,
            kind: "customer_appointment_booked",
            target_user_id: user.id,
            target_tab: "orders",
          };

          for (const adminId of privilegedIds) {
            try {
              const notifId = randomUUID();
              await query(
                `INSERT INTO notifications (id, user_id, title, title_ar, message, message_ar, type, metadata)
                 VALUES ($1, $2, $3, $4, $5, $6, 'info', $7)`,
                [
                  notifId,
                  adminId,
                  adminTitleEn,
                  adminTitleAr,
                  adminMsgEn,
                  adminMsgAr,
                  JSON.stringify(adminMetadata),
                ],
              );
              try {
                broadcastToUser(adminId, {
                  type: "notification",
                  data: {
                    id: notifId,
                    title: adminTitleAr,
                    message: adminMsgAr,
                    type: "info",
                    read: false,
                    created_at: new Date().toISOString(),
                    metadata: adminMetadata,
                  },
                });
              } catch (_e) {
                // websocket broadcast best-effort
              }
            } catch (_err) {
              // continue fan-out even if a single recipient insert fails
            }
          }
        } catch (_err) {
          // privileged fan-out is best-effort
        }
      } catch (_err) {
        // notification is best-effort
      }

      // Real-time fan-out so admin/owner BookingStrip + customer's own
      // calendar refresh instantly without a manual reload.
      // Scoped delivery: only the booking customer + privileged users
      // (owner/admin/partner) receive the payload — never anonymous WS
      // clients — to avoid leaking customer PII.
      try {
        const created = result.rows[0];
        const recipients = new Set<string>();
        if (created.user_id) recipients.add(created.user_id);
        try {
          const privileged = await getPrivilegedUserIds();
          for (const uid of privileged) recipients.add(uid);
        } catch (_e) {
          // ignore — at least notify the customer themselves
        }
        broadcastToUsers(recipients, {
          type: "appointment_created",
          data: {
            id: created.id,
            user_id: created.user_id,
            user_name: created.user_name,
            appointment_date: created.appointment_date,
            service_type: created.service_type,
            car_info: created.car_info,
            status: created.status,
          },
        });
      } catch (_e) {
        // best-effort
      }

      return res.json({ appointment: result.rows[0] });
    } catch (err: any) {
      return res.status(500).json({ detail: err.message });
    }
  });

  // GET /api/appointments/slots — booked slots for availability check
  // Supports ?restaurant_id= to scope results to a specific restaurant
  router.get("/slots", requireAuth as any, async (req: Request, res: Response) => {
    try {
      const user = await getCurrentUser(req);
      if (!user) return res.status(401).json({ detail: "Unauthorized" });
      const restaurantId = req.query.restaurant_id as string | undefined;

      let rows;
      if (restaurantId) {
        rows = await query(
          `SELECT appointment_date, service_type FROM appointments
           WHERE status != 'cancelled'
             AND restaurant_id = $1
           ORDER BY appointment_date ASC`,
          [restaurantId],
        );
      } else {
        rows = await query(
          "SELECT appointment_date, service_type FROM appointments WHERE status != 'cancelled' ORDER BY appointment_date ASC",
        );
      }

      const slotDetails = rows.rows.map((r: any) => ({
        date: r.appointment_date,
        table: r.service_type || "",
      }));
      return res.json({
        slots: rows.rows.map((r: any) => r.appointment_date),
        slot_details: slotDetails,
      });
    } catch (err: any) {
      return res.status(500).json({ detail: err.message });
    }
  });

  // DELETE /api/appointments/:id — delete appointment (admin/owner OR own appointment)
  router.delete(
    "/:id",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const user = await getCurrentUser(req);
        if (!user) return res.status(401).json({ detail: "Unauthorized" });
        const role = await getUserRole(user.email);
        const existing = await query(
          "SELECT * FROM appointments WHERE id=$1",
          [req.params.id],
        );
        if (!existing.rows.length)
          return res.status(404).json({ detail: "Appointment not found" });
        if (!isPrivilegedRole(role) && existing.rows[0].user_id !== user.id)
          return res.status(403).json({ detail: "Forbidden" });
        const prev = existing.rows[0];
        const apptId = String(req.params.id);
        await query("DELETE FROM appointments WHERE id=$1", [apptId]);
        try {
          const recipients = new Set<string>();
          if (prev.user_id) recipients.add(prev.user_id);
          try {
            const privileged = await getPrivilegedUserIds();
            for (const uid of privileged) recipients.add(uid);
          } catch (_e) {
            // ignore
          }
          broadcastToUsers(recipients, {
            type: "appointment_deleted",
            data: {
              id: apptId,
              user_id: prev.user_id,
              appointment_date: prev.appointment_date,
            },
          });
        } catch (_e) {
          // best-effort
        }
        await recordHistory({
          appointmentId: apptId,
          action: "deleted",
          actor: { id: user.id, name: user.name, email: user.email },
          oldValues: {
            appointment_date: prev.appointment_date,
            service_type: prev.service_type,
            status: prev.status,
            car_info: prev.car_info,
            notes: prev.notes,
            duration_minutes: prev.duration_minutes,
          },
          newValues: null,
        });
        return res.json({ success: true });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // PATCH /api/appointments/:id — reschedule appointment (admin/owner)
  router.patch(
    "/:id",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const user = await getCurrentUser(req);
        if (!user) return res.status(401).json({ detail: "Unauthorized" });
        const role = await getUserRole(user.email);
        if (!isPrivilegedRole(role)) {
          return res.status(403).json({ detail: "Forbidden" });
        }

        const existing = await query(
          "SELECT * FROM appointments WHERE id=$1",
          [req.params.id],
        );
        if (!existing.rows.length)
          return res.status(404).json({ detail: "Appointment not found" });
        const prev = existing.rows[0];

        const {
          appointment_date,
          service_type,
          car_info,
          notes,
          duration_minutes,
        } = req.body;

        if (!appointment_date) {
          return res
            .status(400)
            .json({ detail: "appointment_date is required" });
        }

        const newServiceType = service_type ?? prev.service_type;
        const newCarInfo = car_info ?? prev.car_info ?? "";
        const newNotes = notes ?? prev.notes ?? "";
        const newDuration = duration_minutes ?? prev.duration_minutes ?? 60;

        const result = await query(
          `UPDATE appointments
             SET appointment_date=$1,
                 service_type=$2,
                 car_info=$3,
                 notes=$4,
                 duration_minutes=$5,
                 updated_at=NOW()
           WHERE id=$6
           RETURNING *`,
          [
            appointment_date,
            newServiceType,
            newCarInfo,
            newNotes,
            newDuration,
            req.params.id,
          ],
        );

        await recordHistory({
          appointmentId: String(req.params.id),
          action: "rescheduled",
          actor: { id: user.id, name: user.name, email: user.email },
          oldValues: {
            appointment_date: prev.appointment_date,
            service_type: prev.service_type,
            car_info: prev.car_info,
            notes: prev.notes,
            duration_minutes: prev.duration_minutes,
          },
          newValues: {
            appointment_date,
            service_type: newServiceType,
            car_info: newCarInfo,
            notes: newNotes,
            duration_minutes: newDuration,
          },
        });

        // Notify the customer that their appointment was rescheduled.
        try {
          const newTableNum = newServiceType?.startsWith("table_") ? newServiceType.replace("table_", "") : null;
          const newHallInfo = newCarInfo ? ` — ${newCarInfo}` : "";
          const serviceLabelAr = newTableNum ? `حجز طاولة ${newTableNum}${newHallInfo}` : "حجز طاولة";
          const serviceLabelEn = newTableNum ? `Table ${newTableNum} Reservation${newCarInfo ? ` — ${newCarInfo}` : ""}` : "Table Reservation";
          const apptDate = new Date(appointment_date);
          const tz = "Africa/Cairo";
          const dateLabelAr = apptDate.toLocaleDateString("ar-EG", {
            weekday: "long",
            day: "numeric",
            month: "long",
            year: "numeric",
            timeZone: tz,
          });
          const dateLabelEn = apptDate.toLocaleDateString("en-US", {
            weekday: "long",
            day: "numeric",
            month: "long",
            year: "numeric",
            timeZone: tz,
          });
          const timeLabel = apptDate.toLocaleTimeString("en-GB", {
            hour: "2-digit",
            minute: "2-digit",
            timeZone: tz,
          });
          const metadata = {
            kind: "appointment_rescheduled",
            appointment_id: req.params.id,
            appointment_date,
            previous_appointment_date: prev.appointment_date,
            service_type: newServiceType,
            car_info: newCarInfo,
            notes: newNotes,
          };
          if (prev.user_id) {
            const userRow = await query(
              "SELECT preferred_language FROM users WHERE id=$1",
              [prev.user_id],
            );
            const customerLang: "en" | "ar" =
              userRow.rows[0]?.preferred_language === "en" ? "en" : "ar";

            const notifId = randomUUID();
            await query(
              `INSERT INTO notifications (id, user_id, title, title_ar, message, message_ar, type, metadata)
               VALUES ($1, $2, $3, $4, $5, $6, 'info', $7)`,
              [
                notifId,
                prev.user_id,
                `Appointment Rescheduled`,
                `تم تعديل موعدك`,
                `Your ${serviceLabelEn} appointment was rescheduled to ${dateLabelEn} at ${timeLabel}.`,
                `تم تعديل موعد ${serviceLabelAr} إلى يوم ${dateLabelAr} الساعة ${timeLabel}.`,
                JSON.stringify(metadata),
              ],
            );
            try {
              broadcastToUser(prev.user_id, {
                type: "notification",
                data: {
                  id: notifId,
                  title: customerLang === "ar" ? `تم تعديل موعدك` : `Appointment Rescheduled`,
                  message: customerLang === "ar"
                    ? `تم تعديل موعد ${serviceLabelAr} إلى يوم ${dateLabelAr} الساعة ${timeLabel}.`
                    : `Your ${serviceLabelEn} appointment was rescheduled to ${dateLabelEn} at ${timeLabel}.`,
                  type: "info",
                  read: false,
                  created_at: new Date().toISOString(),
                  metadata,
                },
              });
            } catch (_e) {
              // best-effort
            }
          }
        } catch (_err) {
          // notification is best-effort
        }

        // Push the rescheduled appointment so the affected customer +
        // every privileged user's BookingStrip refreshes. Scoped to
        // avoid leaking customer PII to anonymous WS clients.
        try {
          const updated = result.rows[0];
          const recipients = new Set<string>();
          if (updated.user_id) recipients.add(updated.user_id);
          try {
            const privileged = await getPrivilegedUserIds();
            for (const uid of privileged) recipients.add(uid);
          } catch (_e) {
            // ignore
          }
          broadcastToUsers(recipients, {
            type: "appointment_updated",
            data: {
              id: updated.id,
              user_id: updated.user_id,
              user_name: updated.user_name,
              appointment_date: updated.appointment_date,
              service_type: updated.service_type,
              car_info: updated.car_info,
              status: updated.status,
              previous_appointment_date: prev.appointment_date,
            },
          });
        } catch (_e) {
          // best-effort
        }

        return res.json({ appointment: result.rows[0] });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // PATCH /api/appointments/:id/status — update status (admin/owner)
  router.patch(
    "/:id/status",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const user = await getCurrentUser(req);
        if (!user) return res.status(401).json({ detail: "Unauthorized" });
        const role = await getUserRole(user.email);
        if (!isPrivilegedRole(role)) {
          return res.status(403).json({ detail: "Forbidden" });
        }
        const { status } = req.body;
        const existing = await query(
          "SELECT status FROM appointments WHERE id=$1",
          [req.params.id],
        );
        if (!existing.rows.length)
          return res.status(404).json({ detail: "Appointment not found" });
        const prev = existing.rows[0];
        const result = await query(
          "UPDATE appointments SET status=$1, updated_at=NOW() WHERE id=$2 RETURNING *",
          [status, req.params.id],
        );
        if (prev.status !== status) {
          await recordHistory({
            appointmentId: String(req.params.id),
            action: "status_changed",
            actor: { id: user.id, name: user.name, email: user.email },
            oldValues: { status: prev.status },
            newValues: { status },
          });

          const updated = result.rows[0];

          // Bilingual status labels for appointment status changes
          const apptStatusLabels: Record<string, { en: string; ar: string }> = {
            pending:   { en: "Your booking is pending confirmation",        ar: "حجزك قيد الانتظار وسيتم تأكيده قريباً" },
            confirmed: { en: "Your booking has been confirmed",             ar: "تم تأكيد حجزك" },
            cancelled: { en: "Your booking has been cancelled",             ar: "تم إلغاء حجزك" },
            completed: { en: "Your booking is marked as completed",        ar: "تم تحديد حجزك كمكتمل" },
            no_show:   { en: "Your booking was marked as no-show",         ar: "تم تسجيل غيابك عن الموعد" },
          };
          const label = apptStatusLabels[status] ?? {
            en: `Your booking status has been updated to: ${status}`,
            ar: `تم تحديث حالة حجزك إلى: ${status}`,
          };

          // Notify the customer with their preferred language
          if (updated.user_id) {
            try {
              const userRow = await query(
                "SELECT preferred_language FROM users WHERE id=$1",
                [updated.user_id],
              );
              const customerLang: "en" | "ar" =
                userRow.rows[0]?.preferred_language === "en" ? "en" : "ar";

              const apptMeta = {
                kind: "appointment_status_changed",
                appointment_id: updated.id,
                appointment_date: updated.appointment_date,
                new_status: status,
                previous_status: prev.status,
                service_type: updated.service_type,
                car_info: updated.car_info || "",
              };

              const notifId = randomUUID();
              await query(
                `INSERT INTO notifications (id, user_id, title, title_ar, message, message_ar, type, metadata)
                 VALUES ($1, $2, $3, $4, $5, $6, 'info', $7)`,
                [
                  notifId,
                  updated.user_id,
                  "Booking Update",
                  "تحديث الحجز",
                  label.en,
                  label.ar,
                  JSON.stringify(apptMeta),
                ],
              );

              try {
                broadcastToUser(updated.user_id, {
                  type: "notification",
                  data: {
                    id: notifId,
                    title: customerLang === "ar" ? "تحديث الحجز" : "Booking Update",
                    message: label[customerLang],
                    type: "info",
                    read: false,
                    created_at: new Date().toISOString(),
                    metadata: apptMeta,
                  },
                });
              } catch (_e) {
                // websocket broadcast best-effort
              }

              // Send Expo push notification to the customer (fire-and-forget)
              ;(async () => {
                try {
                  interface TokenRow { token: string }
                  const tokenRes = await query(
                    "SELECT token FROM expo_push_tokens WHERE user_id=$1",
                    [updated.user_id],
                  );
                  const customerTokens = (tokenRes.rows as TokenRow[])
                    .map((r) => r.token)
                    .filter(Boolean);
                  if (customerTokens.length === 0) return;

                  const pushMessages = customerTokens.map((token: string) => ({
                    to: token,
                    sound: "default",
                    title: customerLang === "ar" ? "تحديث الحجز" : "Booking Update",
                    body: label[customerLang],
                    data: {
                      type: "appointment_status",
                      appointment_id: updated.id,
                      new_status: status,
                    },
                    priority: "high",
                    channelId: "orders",
                  }));

                  fetch("https://exp.host/--/api/v2/push/send", {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      "Accept": "application/json",
                      "Accept-Encoding": "gzip, deflate",
                    },
                    body: JSON.stringify(pushMessages),
                  }).then(async (pushRes) => {
                    if (!pushRes.ok) {
                      const body = await pushRes.text().catch(() => "(unreadable)");
                      req.log.warn({ status: pushRes.status, body: body.slice(0, 200) }, "[push appt-status] Expo push API HTTP error");
                    } else {
                      req.log.info({ appointment_id: updated.id, new_status: status, recipients: customerTokens.length }, "[push appt-status] Appointment status push sent");
                    }
                  }).catch((fetchErr: unknown) => {
                    req.log.warn({ err: fetchErr instanceof Error ? fetchErr.message : String(fetchErr) }, "[push appt-status] Expo push API network error");
                  });
                } catch (pushErr: unknown) {
                  req.log.warn({ err: pushErr instanceof Error ? pushErr.message : String(pushErr) }, "[push appt-status] Failed to send push notification");
                }
              })();
            } catch (_e) {
              // notification is best-effort; never block the response
            }
          }

          // Broadcast appointment_updated to the customer + all privileged users
          // so their BookingStrip refreshes in real time.
          try {
            const recipients = new Set<string>();
            if (updated.user_id) recipients.add(updated.user_id);
            try {
              const privileged = await getPrivilegedUserIds();
              for (const uid of privileged) recipients.add(uid);
            } catch (_e) {
              // ignore
            }
            broadcastToUsers(recipients, {
              type: "appointment_updated",
              data: {
                id: updated.id,
                user_id: updated.user_id,
                appointment_date: updated.appointment_date,
                status: updated.status,
              },
            });
          } catch (_e) {
            // best-effort
          }
        }
        return res.json({ appointment: result.rows[0] });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // POST /api/appointments/:id/request-change
  // Customer-initiated request to reschedule or cancel an appointment.
  // Side-effects:
  //   1. Get-or-create the customer's customer_support conversation.
  //   2. Insert a `customer` message describing the request — this also
  //      triggers the existing AI auto-reply pipeline.
  //   3. Notify all privileged users (owner/admin/partner) so they can
  //      open the chat and act on the request from their notification
  //      bell.
  //   4. Return the conversation_id so the client can deep-link the
  //      chat screen straight to that conversation.
  router.post(
    "/:id/request-change",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const user = await getCurrentUser(req);
        if (!user) return res.status(401).json({ detail: "Unauthorized" });

        const apptId = String(req.params.id);
        const apptRes = await query(
          "SELECT * FROM appointments WHERE id=$1",
          [apptId],
        );
        if (!apptRes.rows.length)
          return res.status(404).json({ detail: "Appointment not found" });
        const appt = apptRes.rows[0];
        if (appt.user_id && appt.user_id !== user.id)
          return res.status(403).json({ detail: "Forbidden" });

        const tz = "Africa/Cairo";
        const apptDate = new Date(appt.appointment_date);
        const dateLabelAr = apptDate.toLocaleDateString("ar-EG", {
          weekday: "long",
          day: "numeric",
          month: "long",
          year: "numeric",
          timeZone: tz,
        });
        const timeLabel = apptDate.toLocaleTimeString("en-GB", {
          hour: "2-digit",
          minute: "2-digit",
          timeZone: tz,
        });
        const apptTableNum = appt.service_type?.startsWith("table_") ? appt.service_type.replace("table_", "") : null;
        const apptHallInfo = appt.car_info ? ` — ${appt.car_info}` : "";
        const serviceLabelAr = apptTableNum ? `حجز طاولة ${apptTableNum}${apptHallInfo}` : "حجز طاولة";

        // 1) Find or create the customer's support conversation.
        let convRes = await query(
          `SELECT id FROM conversations
            WHERE user_id=$1
              AND type='customer_support'
              AND deleted_at IS NULL
            ORDER BY created_at ASC
            LIMIT 1`,
          [user.id],
        );
        let conversationId: string;
        if (convRes.rows.length) {
          conversationId = convRes.rows[0].id;
        } else {
          conversationId = randomUUID();
          await query(
            `INSERT INTO conversations (id, user_id, type, status)
             VALUES ($1, $2, 'customer_support', 'open')`,
            [conversationId, user.id],
          );
        }

        // 2) Insert the customer message that triggers the AI auto-reply.
        const messageBody =
          `طلب تعديل أو إلغاء موعد حجز\n` +
          `الموعد: ${serviceLabelAr} — ${dateLabelAr} الساعة ${timeLabel}\n` +
          `(رقم الموعد: ${apptId})`;
        const msgId = randomUUID();
        await query(
          `INSERT INTO messages (id, conversation_id, sender_id, sender_type, content, message_type, is_read)
           VALUES ($1, $2, $3, 'customer', $4, 'text', FALSE)`,
          [msgId, conversationId, user.id, messageBody],
        );
        await query(
          `UPDATE conversations SET updated_at = NOW() WHERE id = $1`,
          [conversationId],
        );

        // Real-time push for connected admin chat clients + owner.
        // Uses the same `chat_message` envelope as `/chat/messages` so the
        // existing client listeners (useChat.ts) pick it up correctly.
        try {
          const newMsg = {
            id: msgId,
            conversation_id: conversationId,
            sender_id: user.id,
            sender_type: "customer",
            content: messageBody,
            message_type: "text",
            is_read: false,
            created_at: new Date().toISOString(),
          };
          const recipients = new Set<string>([user.id]);
          const privileged = await getPrivilegedUserIds();
          for (const uid of privileged) recipients.add(uid);
          broadcastToUsers(recipients, {
            type: "chat_message",
            message: newMsg,
            conversation_id: conversationId,
          });
        } catch (_e) {
          // best-effort
        }

        // Server-side AI auto-reply fallback — mirrors /chat/messages so the
        // AI responds even if no admin client is connected to trigger it.
        // doAutoReply is atomic (uses ai_auto_reply_sent flag) so there is
        // no duplicate-reply risk if a connected admin client also races.
        (async () => {
          try {
            await doAutoReply(msgId, conversationId, broadcastToUser);
          } catch (_e) {
            // best-effort; errors already logged inside doAutoReply
          }
        })();

        // 3) Notify privileged users via their bell tray.
        try {
          const privilegedIds = await getPrivilegedUserIds(user.id);
          const notifTitleAr = "طلب تعديل/إلغاء موعد";
          const notifTitleEn = "Appointment change request";
          const customerName = user.name || appt.user_name || "عميل";
          const notifMsgAr =
            `${customerName} طلب تعديل أو إلغاء موعد ${serviceLabelAr} يوم ${dateLabelAr} الساعة ${timeLabel}.`;
          const notifMsgEn =
            `${customerName} requested to change or cancel a ${serviceLabelAr} appointment on ${dateLabelAr} at ${timeLabel}.`;
          const notifMeta = {
            kind: "appointment_change_request",
            appointment_id: apptId,
            target_user_id: user.id,
            conversation_id: conversationId,
            appointment_date: appt.appointment_date,
            service_type: appt.service_type,
            customer_name: customerName,
          };
          for (const adminId of privilegedIds) {
            try {
              const notifId = randomUUID();
              await query(
                `INSERT INTO notifications (id, user_id, title, title_ar, message, message_ar, type, metadata)
                 VALUES ($1, $2, $3, $4, $5, $6, 'warning', $7)`,
                [
                  notifId,
                  adminId,
                  notifTitleEn,
                  notifTitleAr,
                  notifMsgEn,
                  notifMsgAr,
                  JSON.stringify(notifMeta),
                ],
              );
              try {
                broadcastToUser(adminId, {
                  type: "notification",
                  data: {
                    id: notifId,
                    title: notifTitleAr,
                    message: notifMsgAr,
                    type: "warning",
                    read: false,
                    created_at: new Date().toISOString(),
                    metadata: notifMeta,
                  },
                });
              } catch (_e) {
                // best-effort
              }
            } catch (_err) {
              // continue fan-out
            }
          }
        } catch (_err) {
          // best-effort
        }

        return res.json({
          ok: true,
          conversation_id: conversationId,
          message_id: msgId,
        });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // GET /api/appointments/:id/history — list audit history for an appointment
  router.get(
    "/:id/history",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const user = await getCurrentUser(req);
        if (!user) return res.status(401).json({ detail: "Unauthorized" });
        const role = await getUserRole(user.email);
        if (!isPrivilegedRole(role)) {
          return res.status(403).json({ detail: "Forbidden" });
        }
        const rows = await query(
          `SELECT id, appointment_id, action, actor_id, actor_name, actor_email,
                  old_values, new_values, created_at
             FROM appointment_history
            WHERE appointment_id=$1
            ORDER BY created_at DESC
            LIMIT 50`,
          [req.params.id],
        );
        return res.json({ history: rows.rows });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  return router;
}
