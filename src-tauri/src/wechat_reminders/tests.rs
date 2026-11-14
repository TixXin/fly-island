use super::*;
use windows::Win32::UI::WindowsAndMessaging::{GetWindowThreadProcessId, IsIconic};

#[test]
fn visible_main_is_preferred_and_login_windows_are_not_restored() {
    let windows = [
        WeChatWindow {
            handle: HWND::default(),
            started_at: 1,
            main_sized: true,
            visible: false,
        },
        WeChatWindow {
            handle: HWND::default(),
            started_at: 2,
            main_sized: false,
            visible: true,
        },
        WeChatWindow {
            handle: HWND::default(),
            started_at: 3,
            main_sized: true,
            visible: true,
        },
    ];
    assert_eq!(preferred_window(&windows).unwrap().started_at, 3);
    assert_eq!(preferred_window(&windows[..2]).unwrap().started_at, 1);
    assert!(preferred_window(&windows[1..2]).is_none());
}

#[test]
#[ignore = "Activates the registered weixin protocol and verifies the original main process"]
fn window_activation_reuses_the_existing_wechat_process() {
    let executable = installed_executable().unwrap();
    let before = existing_wechat_windows(&executable).unwrap();
    let original = preferred_window(&before.found).expect("WeChat main window is required");
    let mut expected_process = 0;
    unsafe {
        GetWindowThreadProcessId(original.handle, Some(&mut expected_process));
    }
    assert_ne!(expected_process, 0);
    for _ in 0..2 {
        assert!(activate_existing_wechat(&executable).unwrap());
        let after = existing_wechat_windows(&executable).unwrap();
        let window =
            preferred_window(&after.found).expect("The existing main window must be visible");
        let mut process_id = 0;
        unsafe {
            GetWindowThreadProcessId(window.handle, Some(&mut process_id));
        }
        assert_eq!(process_id, expected_process);
        assert!(!unsafe { IsIconic(window.handle) }.as_bool());
    }
}

#[test]
fn repeated_flashes_create_one_reminder_and_activation_acknowledges_it() {
    let mut state = ReminderState::default();
    state.set_enabled(true);
    let generation = state.generation;
    assert!(state.apply(generation, ReminderSignal::Attention, 1000));
    assert!(!state.apply(generation, ReminderSignal::Attention, 2000));
    assert_eq!(state.snapshot.last_attention_at, Some(1000));
    assert!(state.apply(generation, ReminderSignal::Activated, 3000));
    assert!(!state.snapshot.pending);
    assert!(state.apply(generation, ReminderSignal::Attention, 4000));
}

#[test]
fn disabling_clears_pending_state_and_rejects_old_listener_events() {
    let mut state = ReminderState::default();
    state.set_enabled(true);
    let old = state.generation;
    state.apply(old, ReminderSignal::Attention, 1000);
    state.set_enabled(false);
    assert!(!state.snapshot.pending);
    assert!(!state.apply(old, ReminderSignal::Attention, 2000));
    state.set_enabled(true);
    assert!(!state.apply(old, ReminderSignal::Attention, 3000));
    assert!(state.apply(state.generation, ReminderSignal::Attention, 4000));
}

#[test]
fn redraws_and_window_creation_are_not_messages() {
    let mut state = ReminderState::default();
    state.set_enabled(true);
    let generation = state.generation;
    assert!(!state.apply(generation, ReminderSignal::Redraw, 1000));
    assert!(!state.apply(generation, ReminderSignal::WindowCreated, 2000));
    assert!(!state.snapshot.pending);
}

#[test]
fn opening_wechat_prefers_main_window_over_an_older_login_window() {
    let windows = [
        WeChatWindow {
            handle: HWND::default(),
            started_at: 10,
            main_sized: false,
            visible: true,
        },
        WeChatWindow {
            handle: HWND::default(),
            started_at: 20,
            main_sized: true,
            visible: true,
        },
    ];
    assert_eq!(preferred_window(&windows).unwrap().started_at, 20);
}

#[test]
fn opening_wechat_reuses_the_older_main_window_instead_of_a_new_instance() {
    let windows = [
        WeChatWindow {
            handle: HWND::default(),
            started_at: 20,
            main_sized: true,
            visible: true,
        },
        WeChatWindow {
            handle: HWND::default(),
            started_at: 10,
            main_sized: true,
            visible: true,
        },
    ];
    assert_eq!(preferred_window(&windows).unwrap().started_at, 10);
}

#[test]
#[ignore = "Requires a running WeChat desktop session; reads window metadata only"]
fn finds_existing_wechat_main_window_without_launching() {
    let search = existing_wechat_windows(&installed_executable().unwrap()).unwrap();
    let selected = preferred_window(&search.found).expect("An existing WeChat window is required");
    assert!(
        selected.main_sized,
        "The existing main window must be preferred over a login window"
    );
}

#[test]
fn every_message_read_from_the_list_is_published_while_the_reminder_is_pending() {
    let mut state = ReminderState::default();
    state.set_enabled(true);
    let generation = state.generation;
    let message = |chat: &str, at| ChatMessage {
        chat: chat.into(),
        contact: chat.into(),
        preview: "hi".into(),
        unread: Some(1),
        at,
    };
    assert!(state.receive(generation, message("a", 1000)));
    assert!(state.receive(generation, message("b", 1001)));
    assert!(state.snapshot.pending);
    assert_eq!(state.snapshot.last_attention_at, Some(1000));
    assert_eq!(state.snapshot.message.as_ref().map(|m| m.chat.as_str()), Some("b"));
    assert!(!state.receive(generation + 1, message("c", 1002)));
    state.set_enabled(false);
    assert_eq!(state.snapshot.message, None);
}

#[test]
fn the_list_keeps_each_message_and_one_row_per_plain_reminder() {
    let mut state = ReminderState::default();
    state.set_enabled(true);
    let generation = state.generation;
    let message = |chat: &str, at| ChatMessage {
        chat: chat.into(),
        contact: chat.into(),
        preview: "hi".into(),
        unread: None,
        at,
    };
    assert!(state.remind(generation, 1000, Some(PlainReason::Tray)));
    assert!(!state.remind(generation, 2000, Some(PlainReason::Tray)));
    assert!(state.receive(generation, message("a", 3000)));
    assert!(state.apply(generation, ReminderSignal::Activated, 4000));
    assert!(state.apply(generation, ReminderSignal::Attention, 5000));
    let rows: Vec<_> = state
        .snapshot
        .items
        .iter()
        .map(|item| {
            (
                item.at,
                item.message.as_ref().map(|m| m.chat.as_str()),
                item.reason,
            )
        })
        .collect();
    assert_eq!(
        rows,
        [
            (5000, None, None),
            (3000, Some("a"), None),
            (1000, None, Some(PlainReason::Tray))
        ]
    );
    for at in 0..MAX_ITEMS as u64 + 5 {
        state.receive(generation, message("b", 6000 + at));
    }
    assert_eq!(state.snapshot.items.len(), MAX_ITEMS);
    assert_eq!(state.snapshot.items[0].at, 6000 + MAX_ITEMS as u64 + 4);
    state.set_enabled(false);
    assert!(state.snapshot.items.is_empty());
}

fn chat(key: &str, preview: &str, unread: u32) -> chats::Session {
    chats::Session {
        key: key.into(),
        contact: key.into(),
        preview: preview.into(),
        unread: Some(unread),
        muted: false,
        mentioned: false,
    }
}

#[test]
fn the_users_own_message_is_not_news() {
    let before = [chat("x", "早", 0), chat("a", "对方: 在吗", 0)];
    let now = [chat("a", "我: 在", 0), chat("x", "早", 0)];
    assert!(chats::new_messages(&before, &now).is_empty());
    assert!(!chats::muted_changed(&before, &now));
    let now = [chat("a", "对方: 好", 1), chat("x", "早", 0)];
    assert_eq!(chats::new_messages(&before, &now).len(), 1);
}

#[test]
fn a_reply_written_while_a_flash_was_being_read_is_not_news() {
    use std::{cell::RefCell, collections::VecDeque, rc::Rc, time::Duration};
    let looks = Rc::new(RefCell::new(VecDeque::from([Listing::Rows(vec![chat(
        "a", "对方: 在吗", 0,
    )])])));
    let queue = looks.clone();
    let mut reader = ChatReader::new(
        move || queue.borrow_mut().pop_front().unwrap_or(Listing::Unreadable),
        true,
    );
    let outcome = |reader: &mut ChatReader<_>, start: Instant| {
        reader.flashed(start);
        (1..20)
            .find_map(|step| reader.tick(start + Duration::from_millis(250 * step)))
            .expect("an outcome")
    };
    let start = Instant::now();
    reader.flashed(start);
    reader.activated(true, start);
    reader.activated(false, start);
    let replied = || Listing::Rows(vec![chat("a", "我: 在", 0)]);
    looks.borrow_mut().extend([replied(), replied(), replied()]);
    assert_eq!(
        outcome(&mut reader, start),
        Flash::Plain(Some(PlainReason::Unchanged))
    );
    looks
        .borrow_mut()
        .push_back(Listing::Rows(vec![chat("a", "对方: 好", 1)]));
    assert!(matches!(
        outcome(&mut reader, start + Duration::from_secs(10)),
        Flash::Messages(_)
    ));
}
