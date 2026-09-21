import { CronExpressionParser } from "cron-parser";

export function parseRecurrenceRule(ruleStr?: string | null): any | null {
    if (!ruleStr) return null;
    try { return JSON.parse(ruleStr); } catch { return null; }
}

export function getRuleTimezone(ruleStr?: string | null, fallback = "Asia/Jakarta") {
    return parseRecurrenceRule(ruleStr)?.timezone || fallback;
}

export function shouldSkipMissedRun(ruleStr?: string | null) {
    return parseRecurrenceRule(ruleStr)?.catchUpMode === "skip";
}

export function shouldSkipCurrentRun(ruleStr: string | null | undefined, sendAt: Date, now = new Date(), graceMs = 90_000) {
    if (!shouldSkipMissedRun(ruleStr)) return false;
    return now.getTime() - sendAt.getTime() > graceMs;
}

export function getNextRunFromCron(cronExpression: string, ruleStr?: string | null, fallbackTz = "Asia/Jakarta") {
    const timezone = getRuleTimezone(ruleStr, fallbackTz);
    const interval = CronExpressionParser.parse(cronExpression, { tz: timezone });
    return interval.next().toDate();
}

