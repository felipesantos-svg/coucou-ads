export interface CalendarEvent {
  id: string; calendarName?: string; calendarId?: string; summary?: string; location?: string; htmlLink?: string; status?: string;
  start: { date?: string; dateTime?: string }; end: { date?: string; dateTime?: string };
}
export function weekRange(day: Date, offset = 0) {
  const start = new Date(day); start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (start.getDay() + 6) % 7 + offset * 7);
  const end = new Date(start); end.setDate(end.getDate() + 7);
  return { start, end };
}
export function eventStart(event: CalendarEvent): Date {
  return new Date(event.start.dateTime ?? `${event.start.date}T00:00:00`);
}
export function eventsOnDay(events: CalendarEvent[], day: Date) {
  const start = new Date(day); start.setHours(0, 0, 0, 0);
  const end = new Date(start); end.setDate(end.getDate() + 1);
  return events.filter(event => {
    const from = eventStart(event);
    const to = new Date(event.end.dateTime ?? `${event.end.date}T00:00:00`);
    return event.status !== "cancelled" && from < end && (to > start || (+to === +from && from >= start));
  });
}

/** Keep today's events until midnight, including multi-day events until their last day. */
export function upcomingEvents(events: CalendarEvent[], now = new Date()) {
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  return events.filter(event => {
    if (event.status === "cancelled") return false;
    const start = eventStart(event);
    const end = new Date(event.end.dateTime ?? `${event.end.date}T00:00:00`);
    return start >= today || end > today;
  });
}
