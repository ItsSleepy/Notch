//! Calendar: reads one or more iCal (.ics) feeds, e.g. Google Calendar's
//! "Secret address in iCal format", and returns the events from today to a week ahead.
//! Recurring events are expanded with the `rrule` crate. Feeds are cached for 5 minutes.

use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use chrono::{DateTime, Datelike, Local, NaiveDate, NaiveDateTime, TimeZone, Utc};
use rrule::{RRuleSet, Tz};
use serde::Serialize;

const CACHE_FOR: Duration = Duration::from_secs(5 * 60);
const DAYS_AHEAD: i64 = 8;

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CalEvent {
    pub title: String,
    /// Unix ms. For all-day events: local midnight of the first day.
    pub start: i64,
    pub end: i64,
    pub all_day: bool,
    pub location: String,
    /// Which feed it came from (index into the settings list), for colouring.
    pub cal: usize,
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct CalendarData {
    pub configured: bool,
    pub events: Vec<CalEvent>,
    pub error: Option<String>,
    /// Unix ms of the last successful fetch.
    pub fetched_at: i64,
}

#[derive(Default)]
struct Cache {
    urls: Vec<String>,
    at: Option<Instant>,
    data: CalendarData,
}

#[derive(Default, Clone)]
pub struct CalState(Arc<Mutex<Cache>>);

impl CalState {
    /// Cached events, refetching when older than 5 minutes, when the feed list changed, or on `force`.
    pub fn get(&self, urls: Vec<String>, force: bool) -> CalendarData {
        let urls: Vec<String> = urls.into_iter().map(|u| u.trim().to_string()).filter(|u| !u.is_empty()).collect();
        if urls.is_empty() {
            return CalendarData::default();
        }
        {
            let cache = self.0.lock().unwrap_or_else(|e| e.into_inner());
            let fresh = cache.at.is_some_and(|t| t.elapsed() < CACHE_FOR);
            if fresh && !force && cache.urls == urls {
                return cache.data.clone();
            }
        }
        let data = fetch_all(&urls);
        let mut cache = self.0.lock().unwrap_or_else(|e| e.into_inner());
        // Keep showing the last good events if every feed failed this time.
        let data = if data.events.is_empty() && data.error.is_some() && cache.urls == urls {
            CalendarData { error: data.error, ..cache.data.clone() }
        } else {
            data
        };
        cache.urls = urls;
        cache.at = Some(Instant::now());
        cache.data = data.clone();
        data
    }
}

fn fetch_all(urls: &[String]) -> CalendarData {
    let now = Local::now();
    let from = Local
        .from_local_datetime(&now.date_naive().and_hms_opt(0, 0, 0).unwrap())
        .earliest()
        .unwrap_or(now);
    let to = from + chrono::Duration::days(DAYS_AHEAD);

    let mut events = Vec::new();
    let mut errors = Vec::new();
    for (i, url) in urls.iter().enumerate() {
        // Google shows "webcal://" links in some places; it's plain https underneath.
        let url = url.strip_prefix("webcal://").map(|u| format!("https://{u}")).unwrap_or_else(|| url.clone());
        match fetch(&url) {
            Ok(text) => events.extend(parse_ics(&text, i, from.with_timezone(&Utc), to.with_timezone(&Utc))),
            Err(e) => errors.push(format!("Calendar {}: {e}", i + 1)),
        }
    }
    events.sort_by(|a, b| (a.start, !a.all_day, &a.title).cmp(&(b.start, !b.all_day, &b.title)));
    CalendarData {
        configured: true,
        events,
        error: (!errors.is_empty()).then(|| errors.join(" · ")),
        fetched_at: Utc::now().timestamp_millis(),
    }
}

fn fetch(url: &str) -> Result<String, String> {
    let resp = ureq::get(url)
        .timeout(Duration::from_secs(10))
        .call()
        .map_err(|e| match e {
            ureq::Error::Status(code, _) => format!("the server said {code} (check the link)"),
            other => format!("couldn't connect ({other})"),
        })?;
    let text = resp.into_string().map_err(|e| e.to_string())?;
    if !text.contains("BEGIN:VCALENDAR") {
        return Err("that link isn't an iCal feed".into());
    }
    Ok(text)
}

// ---------- parsing ----------

#[derive(Default, Clone)]
struct Prop {
    params: Vec<(String, String)>,
    value: String,
}

impl Prop {
    fn param(&self, name: &str) -> Option<&str> {
        self.params.iter().find(|(k, _)| k.eq_ignore_ascii_case(name)).map(|(_, v)| v.as_str())
    }
}

#[derive(Default)]
struct RawEvent {
    uid: String,
    summary: String,
    location: String,
    status: String,
    dtstart: Option<Prop>,
    dtend: Option<Prop>,
    duration: Option<String>,
    rrule: Option<String>,
    exdates: Vec<Prop>,
    recurrence_id: Option<Prop>,
}

/// A moment as written in the feed.
#[derive(Clone, Copy, Debug)]
enum When {
    /// All-day: a calendar date.
    Date(NaiveDate),
    /// An absolute instant (UTC "Z" times, or a known TZID).
    Instant(DateTime<Utc>, Option<chrono_tz::Tz>),
    /// Wall-clock time with no usable zone: read in the computer's local time.
    Floating(NaiveDateTime),
}

impl When {
    fn parse(p: &Prop) -> Option<When> {
        let v = p.value.trim();
        if p.param("VALUE").is_some_and(|x| x.eq_ignore_ascii_case("DATE")) || v.len() == 8 {
            return NaiveDate::parse_from_str(v, "%Y%m%d").ok().map(When::Date);
        }
        if let Some(z) = v.strip_suffix('Z') {
            let n = NaiveDateTime::parse_from_str(z, "%Y%m%dT%H%M%S").ok()?;
            return Some(When::Instant(Utc.from_utc_datetime(&n), None));
        }
        let n = NaiveDateTime::parse_from_str(v, "%Y%m%dT%H%M%S").ok()?;
        if let Some(tz) = p.param("TZID").and_then(|t| t.trim_matches('"').parse::<chrono_tz::Tz>().ok()) {
            let dt = tz.from_local_datetime(&n).earliest()?;
            return Some(When::Instant(dt.with_timezone(&Utc), Some(tz)));
        }
        Some(When::Floating(n))
    }

    /// The instant this starts, in UTC (dates and floating times use local time).
    fn utc(&self) -> DateTime<Utc> {
        match *self {
            When::Date(d) => local_to_utc(d.and_hms_opt(0, 0, 0).unwrap()),
            When::Instant(t, _) => t,
            When::Floating(n) => local_to_utc(n),
        }
    }
}

fn local_to_utc(n: NaiveDateTime) -> DateTime<Utc> {
    Local
        .from_local_datetime(&n)
        .earliest()
        .map(|t| t.with_timezone(&Utc))
        .unwrap_or_else(|| Utc.from_utc_datetime(&n))
}

/// Joins folded lines (RFC 5545 §3.1).
fn unfold(text: &str) -> Vec<String> {
    let mut lines: Vec<String> = Vec::new();
    for raw in text.split('\n') {
        let line = raw.strip_suffix('\r').unwrap_or(raw);
        if (line.starts_with(' ') || line.starts_with('\t')) && !lines.is_empty() {
            lines.last_mut().unwrap().push_str(&line[1..]);
        } else {
            lines.push(line.to_string());
        }
    }
    lines
}

/// "DTSTART;TZID=Europe/Malta:20261107T093000" -> ("DTSTART", Prop)
fn split_line(line: &str) -> Option<(String, Prop)> {
    // The value starts at the first ':' that isn't inside a quoted parameter.
    let mut in_quotes = false;
    let mut colon = None;
    for (i, c) in line.char_indices() {
        match c {
            '"' => in_quotes = !in_quotes,
            ':' if !in_quotes => {
                colon = Some(i);
                break;
            }
            _ => {}
        }
    }
    let colon = colon?;
    let (head, value) = (&line[..colon], &line[colon + 1..]);
    let mut parts = head.split(';');
    let name = parts.next()?.trim().to_ascii_uppercase();
    let params = parts
        .filter_map(|p| p.split_once('='))
        .map(|(k, v)| (k.trim().to_ascii_uppercase(), v.trim().to_string()))
        .collect();
    Some((name, Prop { params, value: value.to_string() }))
}

fn unescape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        if c == '\\' {
            match chars.next() {
                Some('n') | Some('N') => out.push(' '),
                Some(other) => out.push(other),
                None => {}
            }
        } else {
            out.push(c);
        }
    }
    out.trim().to_string()
}

fn raw_events(text: &str) -> Vec<RawEvent> {
    let mut out = Vec::new();
    let mut cur: Option<RawEvent> = None;
    let mut depth = 0; // nested components (VALARM) inside an event
    for line in unfold(text) {
        let upper = line.trim().to_ascii_uppercase();
        if upper == "BEGIN:VEVENT" {
            cur = Some(RawEvent::default());
            depth = 0;
            continue;
        }
        if upper == "END:VEVENT" {
            if let Some(e) = cur.take() {
                out.push(e);
            }
            continue;
        }
        let Some(ev) = cur.as_mut() else { continue };
        if upper.starts_with("BEGIN:") {
            depth += 1;
            continue;
        }
        if upper.starts_with("END:") {
            depth -= 1;
            continue;
        }
        if depth > 0 {
            continue;
        }
        let Some((name, prop)) = split_line(&line) else { continue };
        match name.as_str() {
            "UID" => ev.uid = prop.value.trim().to_string(),
            "SUMMARY" => ev.summary = unescape(&prop.value),
            "LOCATION" => ev.location = unescape(&prop.value),
            "STATUS" => ev.status = prop.value.trim().to_ascii_uppercase(),
            "DTSTART" => ev.dtstart = Some(prop),
            "DTEND" => ev.dtend = Some(prop),
            "DURATION" => ev.duration = Some(prop.value.trim().to_string()),
            "RRULE" => ev.rrule = Some(prop.value.trim().to_string()),
            "EXDATE" => {
                // One EXDATE line can hold several comma-separated dates.
                for v in prop.value.split(',') {
                    ev.exdates.push(Prop { params: prop.params.clone(), value: v.to_string() });
                }
            }
            "RECURRENCE-ID" => ev.recurrence_id = Some(prop),
            _ => {}
        }
    }
    out
}

/// "PT1H30M", "P1D", "-PT15M" -> seconds
fn parse_duration(s: &str) -> Option<i64> {
    let (sign, s) = match s.strip_prefix('-') {
        Some(rest) => (-1, rest),
        None => (1, s.strip_prefix('+').unwrap_or(s)),
    };
    let s = s.strip_prefix('P')?;
    let mut total = 0i64;
    let mut num = String::new();
    let mut in_time = false;
    for c in s.chars() {
        match c {
            'T' => in_time = true,
            '0'..='9' => num.push(c),
            _ => {
                let n: i64 = num.parse().ok()?;
                num.clear();
                total += n * match (c, in_time) {
                    ('W', _) => 7 * 86400,
                    ('D', _) => 86400,
                    ('H', true) => 3600,
                    ('M', true) => 60,
                    ('S', true) => 1,
                    _ => return None,
                };
            }
        }
    }
    Some(sign * total)
}

/// How long each occurrence lasts, in seconds.
fn length_secs(start: &When, ev: &RawEvent) -> i64 {
    if let Some(end) = ev.dtend.as_ref().and_then(When::parse) {
        let secs = (end.utc() - start.utc()).num_seconds();
        if secs > 0 {
            return secs;
        }
    }
    if let Some(d) = ev.duration.as_deref().and_then(parse_duration) {
        if d > 0 {
            return d;
        }
    }
    if matches!(start, When::Date(_)) { 86400 } else { 0 }
}

/// Key used to match RECURRENCE-ID overrides and EXDATEs against generated occurrences.
fn occurrence_key(w: &When) -> i64 {
    match *w {
        When::Date(d) => d.num_days_from_ce() as i64,
        _ => w.utc().timestamp(),
    }
}

/// Expands a recurring event into its start times between `from` and `to`.
fn expand(start: &When, rule: &str, from: DateTime<Utc>, to: DateTime<Utc>) -> Vec<When> {
    // rrule wants a zone it knows. Dates and floating times are expanded as if they were UTC
    // wall-clock times and converted back afterwards, which keeps "every day at 9:00" at 9:00.
    let (dtstart, tz): (String, Tz) = match *start {
        When::Instant(t, Some(zone)) => (
            format!("DTSTART;TZID={}:{}", zone.name(), t.with_timezone(&zone).format("%Y%m%dT%H%M%S")),
            Tz::Tz(zone),
        ),
        When::Instant(t, None) => (format!("DTSTART:{}Z", t.format("%Y%m%dT%H%M%S")), Tz::UTC),
        When::Date(d) => (format!("DTSTART:{}T000000Z", d.format("%Y%m%d")), Tz::UTC),
        When::Floating(n) => (format!("DTSTART:{}Z", n.format("%Y%m%dT%H%M%S")), Tz::UTC),
    };
    // UNTIL must match DTSTART's form; a bare date UNTIL is common in all-day feeds.
    let rule = normalise_until(rule);
    let Ok(set) = format!("{dtstart}\nRRULE:{rule}").parse::<RRuleSet>() else {
        return Vec::new();
    };

    // Window bounds in the same "clock" the rule runs on.
    let (lo, hi) = match *start {
        When::Date(_) | When::Floating(_) => {
            let lo = from.with_timezone(&Local).naive_local() - chrono::Duration::days(2);
            let hi = to.with_timezone(&Local).naive_local();
            (Tz::UTC.from_utc_datetime(&lo), Tz::UTC.from_utc_datetime(&hi))
        }
        _ => (
            (from - chrono::Duration::days(2)).with_timezone(&tz),
            to.with_timezone(&tz),
        ),
    };
    let result = set.after(lo).before(hi).all(500);
    result
        .dates
        .into_iter()
        .map(|d| match *start {
            When::Date(_) => When::Date(d.naive_utc().date()),
            When::Floating(_) => When::Floating(d.naive_utc()),
            When::Instant(_, zone) => When::Instant(d.with_timezone(&Utc), zone),
        })
        .collect()
}

/// "UNTIL=20261231" -> "UNTIL=20261231T235959Z"; times without Z get one.
fn normalise_until(rule: &str) -> String {
    rule.split(';')
        .map(|part| match part.split_once('=') {
            Some((k, v)) if k.eq_ignore_ascii_case("UNTIL") => {
                let v = v.trim();
                if v.len() == 8 {
                    format!("UNTIL={v}T235959Z")
                } else if !v.ends_with('Z') {
                    format!("UNTIL={v}Z")
                } else {
                    format!("UNTIL={v}")
                }
            }
            _ => part.to_string(),
        })
        .collect::<Vec<_>>()
        .join(";")
}

pub fn parse_ics(text: &str, cal: usize, from: DateTime<Utc>, to: DateTime<Utc>) -> Vec<CalEvent> {
    let raws = raw_events(text);

    // Occurrences that were moved or edited individually: skip them in the series.
    let overridden: HashSet<(String, i64)> = raws
        .iter()
        .filter_map(|e| Some((e.uid.clone(), occurrence_key(&When::parse(e.recurrence_id.as_ref()?)?))))
        .collect();

    let mut out = Vec::new();
    for ev in &raws {
        if ev.status == "CANCELLED" {
            continue;
        }
        let Some(start) = ev.dtstart.as_ref().and_then(When::parse) else { continue };
        let len = length_secs(&start, ev);
        let all_day = matches!(start, When::Date(_));

        let starts: Vec<When> = match (&ev.rrule, &ev.recurrence_id) {
            (Some(rule), None) => {
                let excluded: HashSet<i64> = ev.exdates.iter().filter_map(When::parse).map(|w| occurrence_key(&w)).collect();
                expand(&start, rule, from, to)
                    .into_iter()
                    .filter(|w| {
                        let k = occurrence_key(w);
                        !excluded.contains(&k) && !overridden.contains(&(ev.uid.clone(), k))
                    })
                    .collect()
            }
            _ => vec![start],
        };

        for s in starts {
            let begin = s.utc();
            let end = begin + chrono::Duration::seconds(len);
            // Keep anything that overlaps the window (so an event still running counts).
            if end <= from || begin >= to {
                continue;
            }
            out.push(CalEvent {
                title: if ev.summary.is_empty() { "(No title)".into() } else { ev.summary.clone() },
                start: begin.timestamp_millis(),
                end: end.timestamp_millis(),
                all_day,
                location: ev.location.clone(),
                cal,
            });
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const ICS: &str = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\n\
BEGIN:VEVENT\r\nUID:a\r\nSUMMARY:Design review\r\nDTSTART;TZID=Europe/Malta:20261109T095000\r\nDTEND;TZID=Europe/Malta:20261109T103000\r\nEND:VEVENT\r\n\
BEGIN:VEVENT\r\nUID:b\r\nSUMMARY:Gym\\, legs\r\nDTSTART:20261102T170000Z\r\nDURATION:PT1H\r\nRRULE:FREQ=WEEKLY;BYDAY=MO,WE\r\nEXDATE:20261111T170000Z\r\nEND:VEVENT\r\n\
BEGIN:VEVENT\r\nUID:b\r\nRECURRENCE-ID:20261116T170000Z\r\nSUMMARY:Gym (moved)\r\nDTSTART:20261116T190000Z\r\nDTEND:20261116T200000Z\r\nEND:VEVENT\r\n\
BEGIN:VEVENT\r\nUID:c\r\nSUMMARY:Release day\r\nDTSTART;VALUE=DATE:20261110\r\nDTEND;VALUE=DATE:20261111\r\n\
BEGIN:VALARM\r\nSUMMARY:ignore me\r\nEND:VALARM\r\nEND:VEVENT\r\n\
BEGIN:VEVENT\r\nUID:d\r\nSUMMARY:Bin day\r\nDTSTART;VALUE=DATE:20260101\r\nRRULE:FREQ=WEEKLY;BYDAY=TU;UNTIL=20261117\r\nEND:VEVENT\r\n\
BEGIN:VEVENT\r\nUID:e\r\nSUMMARY:Cancelled thing\r\nSTATUS:CANCELLED\r\nDTSTART:20261110T100000Z\r\nEND:VEVENT\r\n\
BEGIN:VEVENT\r\nUID:f\r\nSUMMARY:Long title that is\r\n  folded\r\nDTSTART:20261112T080000Z\r\nEND:VEVENT\r\n\
END:VCALENDAR\r\n";

    #[test]
    fn parses_and_expands() {
        let from = Utc.with_ymd_and_hms(2026, 11, 9, 0, 0, 0).unwrap();
        let to = Utc.with_ymd_and_hms(2026, 11, 18, 0, 0, 0).unwrap();
        let ev = parse_ics(ICS, 0, from, to);
        let titles: Vec<String> = ev.iter().map(|e| e.title.clone()).collect();
        println!("{:#?}", ev.iter().map(|e| (&e.title, Utc.timestamp_millis_opt(e.start).unwrap(), e.all_day)).collect::<Vec<_>>());
        assert!(titles.contains(&"Design review".into()));
        assert!(titles.contains(&"Gym, legs".into()));
        assert!(titles.contains(&"Gym (moved)".into()));
        assert!(titles.contains(&"Release day".into()));
        assert!(titles.contains(&"Long title that is folded".into()));
        assert!(!titles.iter().any(|t| t.contains("Cancelled") || t.contains("ignore")));
        // Gym: Mon 9, (Wed 11 excluded), Mon 16 overridden -> only Mon 9 from the series
        assert_eq!(titles.iter().filter(|t| *t == "Gym, legs").count(), 1);
        // Bin day: Tuesdays 10 and 17 (UNTIL 17th inclusive)
        assert_eq!(titles.iter().filter(|t| *t == "Bin day").count(), 2);
        let dr = ev.iter().find(|e| e.title == "Design review").unwrap();
        assert_eq!(Utc.timestamp_millis_opt(dr.start).unwrap(), Utc.with_ymd_and_hms(2026, 11, 9, 8, 50, 0).unwrap());
        assert_eq!(dr.end - dr.start, 40 * 60 * 1000);
    }

    #[test]
    fn durations() {
        assert_eq!(parse_duration("PT1H30M"), Some(5400));
        assert_eq!(parse_duration("P1D"), Some(86400));
        assert_eq!(parse_duration("P1W"), Some(604800));
    }
}
