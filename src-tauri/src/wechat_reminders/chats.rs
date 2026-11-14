use std::collections::HashMap;

use windows::Win32::Foundation::HWND;

use crate::win32::uia_list;

#[derive(Clone, Debug, PartialEq)]
pub(super) struct Session {
    pub(super) key: String,
    pub(super) contact: String,
    pub(super) preview: String,
    pub(super) unread: Option<u32>,
    pub(super) muted: bool,
    pub(super) mentioned: bool,
}

const STATUS_LINES: [&str; 10] = [
    "已置顶",
    "置顶聊天",
    "消息免打扰",
    "免打扰",
    "静音",
    "折叠的聊天",
    "有新消息",
    "以下为新消息",
    "有人@我",
    "@我",
];
const MUTED_LINES: [&str; 3] = ["消息免打扰", "免打扰", "静音"];
const MENTION_MARKS: [&str; 3] = ["有人@我", "@我", "@所有人"];
const SERVICE_ACCOUNTS: &str = "服务号";

pub(super) fn parse(automation_id: &str, name: &str) -> Option<Session> {
    let lines: Vec<&str> = name
        .split('\n')
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect();
    if lines.len() < 2 {
        return None;
    }
    let contact = lines[0].to_string();
    let key = automation_id
        .strip_prefix("session_item_")
        .filter(|id| !id.is_empty())
        .map_or_else(|| contact.clone(), str::to_string);
    let end = (1..lines.len())
        .find(|&i| is_timestamp(lines[i]))
        .unwrap_or(lines.len());
    let unread = lines[1..end].iter().find_map(|line| unread_count(line));
    let parts: Vec<&str> = lines[1..end]
        .iter()
        .copied()
        .filter(|line| {
            !STATUS_LINES.contains(line)
                && unread_count(line).is_none()
                && *line != SERVICE_ACCOUNTS
        })
        .collect();
    let preview = if lines[1] == SERVICE_ACCOUNTS {
        parts.first()
    } else {
        parts.last()
    };
    Some(Session {
        key,
        contact,
        preview: preview.map_or_else(String::new, |line| line.to_string()),
        unread,
        muted: lines.iter().any(|line| MUTED_LINES.contains(line)),
        mentioned: lines[1..end].iter().any(|line| is_mention(line)),
    })
}

fn is_mention(line: &str) -> bool {
    MENTION_MARKS.iter().any(|mark| {
        let bracketed = line.strip_prefix('[').and_then(|rest| rest.strip_prefix(mark));
        line == *mark || bracketed.is_some_and(|rest| rest.starts_with(']'))
    })
}

fn changed(before: &HashMap<&str, &Session>, row: &Session) -> bool {
    let old = before.get(row.key.as_str()).and_then(|old| old.unread);
    row.unread.unwrap_or(0) > old.unwrap_or(0)
}

fn by_key(rows: &[Session]) -> HashMap<&str, &Session> {
    rows.iter().map(|row| (row.key.as_str(), row)).collect()
}

pub(super) fn muted_changed(before: &[Session], now: &[Session]) -> bool {
    let before = by_key(before);
    now.iter()
        .any(|row| row.muted && !row.mentioned && !row.preview.is_empty() && changed(&before, row))
}

pub(super) fn new_messages<'a>(before: &[Session], now: &'a [Session]) -> Vec<&'a Session> {
    let before = by_key(before);
    now.iter()
        .filter(|row| (!row.muted || row.mentioned) && !row.preview.is_empty())
        .filter(|row| changed(&before, row))
        .collect()
}

const ROW_PREFIX: &str = "session_item_";

pub(super) fn read(window: HWND) -> Option<Vec<Session>> {
    let rows = uia_list::list_rows(window, ROW_PREFIX)?;
    let chats: Vec<Session> = rows
        .iter()
        .filter_map(|row| parse(&row.id, &row.name))
        .collect();
    (!chats.is_empty()).then_some(chats)
}

pub(super) fn open(window: HWND, key: &str) -> Result<(), &'static str> {
    let rows = uia_list::list_rows(window, ROW_PREFIX).ok_or("the chat list is not readable")?;
    let row = rows
        .iter()
        .find(|row| parse(&row.id, &row.name).is_some_and(|chat| chat.key == key))
        .ok_or("the chat is not in the list")?;
    let at = row.center.ok_or("the chat is scrolled out of view")?;
    uia_list::click_in(window, at)
        .then_some(())
        .ok_or("the chat's row is covered")
}

fn is_timestamp(line: &str) -> bool {
    line.split(' ').all(|part| is_clock(part) || is_date(part))
}

fn is_clock(text: &str) -> bool {
    let Some((hours, minutes)) = text.split_once(':') else {
        return false;
    };
    let number = |part: &str, len: std::ops::RangeInclusive<usize>, max: u32| {
        len.contains(&part.len())
            && part.bytes().all(|b| b.is_ascii_digit())
            && part.parse::<u32>().is_ok_and(|n| n <= max)
    };
    number(hours, 1..=2, 23) && number(minutes, 2..=2, 59)
}

fn is_date(text: &str) -> bool {
    if ["昨天", "前天", "刚刚"].contains(&text) {
        return true;
    }
    let weekday = text
        .strip_prefix("星期")
        .or_else(|| text.strip_prefix("周"));
    if let Some(day) = weekday {
        return ["一", "二", "三", "四", "五", "六", "日", "天"].contains(&day);
    }
    let parts: Vec<&str> = text.split('/').collect();
    (2..=3).contains(&parts.len())
        && parts
            .iter()
            .all(|part| (1..=4).contains(&part.len()) && part.bytes().all(|b| b.is_ascii_digit()))
}

fn unread_count(line: &str) -> Option<u32> {
    let digits = match line
        .strip_prefix('[')
        .and_then(|rest| rest.strip_suffix(']'))
    {
        Some(inner) => inner.trim().trim_end_matches('条').trim_end(),
        None => ["条未读消息", "条未读", "条新消息"]
            .iter()
            .find_map(|suffix| line.strip_suffix(suffix))?
            .trim_end(),
    };
    (!digits.is_empty() && digits.bytes().all(|b| b.is_ascii_digit()))
        .then(|| digits.parse().ok())
        .flatten()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(key: &str, preview: &str, unread: Option<u32>) -> Session {
        Session {
            key: key.into(),
            contact: key.into(),
            preview: preview.into(),
            unread,
            muted: false,
            mentioned: false,
        }
    }

    #[test]
    fn parses_contact_preview_unread_and_time() {
        let s = parse(
            "session_item_wxid_a",
            "小林\n[2条]\n下午一起开会吗？\n12:41",
        )
        .unwrap();
        assert_eq!(
            (
                s.key.as_str(),
                s.contact.as_str(),
                s.preview.as_str(),
                s.unread
            ),
            ("wxid_a", "小林", "下午一起开会吗？", Some(2))
        );
        assert!(!s.muted);

        let s = parse("", "项目群\n消息免打扰\n张三: 收到\n昨天").unwrap();
        assert_eq!(
            (s.key.as_str(), s.preview.as_str(), s.unread, s.muted),
            ("项目群", "张三: 收到", None, true)
        );

        let s = parse(
            "session_item_",
            "服务号\n服务号\n最新一条\n更早一条\n星期三",
        )
        .unwrap();
        assert_eq!(s.preview, "最新一条");
        assert_eq!(parse("x", "只有一行"), None);
    }

    #[test]
    fn recognises_times_dates_and_counts() {
        for line in [
            "9:05",
            "23:41",
            "昨天",
            "星期日",
            "周三",
            "11/9",
            "25/11/09",
            "昨天 12:30",
        ] {
            assert!(is_timestamp(line), "{line}");
        }
        for line in ["24:00", "9:5", "明天", "12:30pm", "3条"] {
            assert!(!is_timestamp(line), "{line}");
        }
        assert_eq!(unread_count("[12条]"), Some(12));
        assert_eq!(unread_count("[3]"), Some(3));
        assert_eq!(unread_count("5条未读消息"), Some(5));
        assert_eq!(unread_count("[链接]"), None);
        assert_eq!(unread_count("条未读"), None);
    }

    #[test]
    fn only_rows_with_a_new_message_count() {
        let before = [row("a", "早", None), row("b", "好", Some(1))];
        let now = [
            row("a", "开会吗", None),
            row("b", "好", Some(2)),
            row("c", "滚进来的", None),
            row("d", "新聊天", Some(1)),
        ];
        let keys: Vec<&str> = new_messages(&before, &now)
            .iter()
            .map(|r| r.key.as_str())
            .collect();
        assert_eq!(keys, ["b", "d"]);

        let mut muted = row("a", "又一条", Some(3));
        muted.muted = true;
        let now = [muted, row("b", "好", Some(1))];
        assert!(new_messages(&before, &now).is_empty());
        assert!(muted_changed(&before, &now));
        assert!(!muted_changed(&before, &before));
    }

    #[test]
    fn a_mention_in_a_muted_chat_counts() {
        let before = [parse("session_item_g", "项目群\n消息免打扰\n张三: 收到\n昨天").unwrap()];
        for name in [
            "项目群\n[2条]\n有人@我\n李四: 看一下\n12:41\n消息免打扰",
            "项目群\n[2条]\n[有人@我] 李四: 看一下\n12:41\n消息免打扰",
            "项目群\n[1条]\n[@所有人] 李四: 开会\n12:41\n消息免打扰",
        ] {
            let now = [parse("session_item_g", name).unwrap()];
            assert!(now[0].muted && now[0].mentioned, "{name}");
            assert_eq!(new_messages(&before, &now).len(), 1, "{name}");
            assert!(!muted_changed(&before, &now), "{name}");
        }
        assert!(!before[0].mentioned);
    }

    #[test]
    fn at_me_inside_a_message_of_a_muted_chat_does_not_count() {
        let before = [parse("session_item_g", "项目群\n消息免打扰\n张三: 收到\n昨天").unwrap()];
        for name in [
            "项目群\n[2条]\n李四: 有事@我\n12:41\n消息免打扰",
            "项目群\n[1条]\n李四: @我们组的同学 开会\n12:41\n消息免打扰",
            "项目群\n[1条]\n李四: 记得@所有人\n12:41\n消息免打扰",
        ] {
            let now = [parse("session_item_g", name).unwrap()];
            assert!(now[0].muted && !now[0].mentioned, "{name}");
            assert!(new_messages(&before, &now).is_empty(), "{name}");
            assert!(muted_changed(&before, &now), "{name}");
        }
    }

    #[test]
    fn a_move_to_the_top_or_a_new_text_without_a_count_is_not_news() {
        let before = [row("a", "早", None), row("b", "好的", None)];
        let own = [row("b", "这都不占啥空间呀", None), row("a", "早", None)];
        assert!(new_messages(&before, &own).is_empty());
        let theirs = [row("b", "嗯", Some(1)), row("a", "早", None)];
        assert_eq!(new_messages(&before, &theirs), [&theirs[0]]);
        let scrolled = [row("x", "很久以前", None), row("a", "早", None)];
        assert!(new_messages(&before, &scrolled).is_empty());
        assert!(new_messages(&before, &before).is_empty());
    }
}
