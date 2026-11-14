use windows::{
    core::Interface,
    Win32::{
        Foundation::{HWND, POINT},
        System::{
            Com::{CoCreateInstance, CLSCTX_INPROC_SERVER},
            Variant::VARIANT,
        },
        UI::{
            Accessibility::{
                CUIAutomation8, IUIAutomation, IUIAutomation2, TreeScope_Children,
                TreeScope_Descendants, UIA_ControlTypePropertyId, UIA_ListControlTypeId,
                UIA_ListItemControlTypeId,
            },
            Input::KeyboardAndMouse::{
                SendInput, INPUT, INPUT_0, INPUT_MOUSE, MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP,
                MOUSEINPUT,
            },
            WindowsAndMessaging::{GetAncestor, SetCursorPos, WindowFromPoint, GA_ROOT},
        },
    },
};

use super::{com::ComApartment, window};

const TIMEOUT_MS: u32 = 1000;

pub(crate) struct ListRow {
    pub id: String,
    pub name: String,
    pub center: Option<POINT>,
}

pub(crate) fn list_rows(window: HWND, prefix: &str) -> Option<Vec<ListRow>> {
    if window.is_invalid() {
        return None;
    }
    let _com = ComApartment::multithreaded().ok();
    read(window, prefix).ok().flatten()
}

pub(crate) fn shows_qt_controls(window: HWND) -> bool {
    if window.is_invalid() {
        return false;
    }
    let _com = ComApartment::multithreaded().ok();
    let check = || -> windows::core::Result<bool> {
        unsafe {
            let root = automation()?.ElementFromHandle(window)?;
            let framework = root
                .CurrentFrameworkId()
                .map(|id| id.to_string())
                .unwrap_or_default();
            let class = root
                .CurrentClassName()
                .map(|name| name.to_string())
                .unwrap_or_default();
            Ok(framework == "Qt" || class.starts_with("mmui::"))
        }
    };
    check().unwrap_or(false)
}

pub(super) unsafe fn automation() -> windows::core::Result<IUIAutomation> {
    unsafe {
        let automation: IUIAutomation =
            CoCreateInstance(&CUIAutomation8, None, CLSCTX_INPROC_SERVER)?;
        if let Ok(options) = automation.cast::<IUIAutomation2>() {
            let _ = options.SetConnectionTimeout(TIMEOUT_MS);
            let _ = options.SetTransactionTimeout(TIMEOUT_MS);
        }
        Ok(automation)
    }
}

fn read(window: HWND, prefix: &str) -> windows::core::Result<Option<Vec<ListRow>>> {
    unsafe {
        let automation = automation()?;
        let root = automation.ElementFromHandle(window)?;
        let of_type = |id: i32| {
            automation.CreatePropertyCondition(UIA_ControlTypePropertyId, &VARIANT::from(id))
        };
        let lists = root.FindAll(TreeScope_Descendants, &of_type(UIA_ListControlTypeId.0)?)?;
        if lists.Length()? == 0 {
            return Ok(None);
        }
        let is_item = of_type(UIA_ListItemControlTypeId.0)?;
        let mut rows = Vec::new();
        for list in 0..lists.Length()? {
            let items = lists
                .GetElement(list)?
                .FindAll(TreeScope_Children, &is_item)?;
            for index in 0..items.Length()? {
                let item = items.GetElement(index)?;
                let id = item
                    .CurrentAutomationId()
                    .map(|id| id.to_string())
                    .unwrap_or_default();
                if !id.starts_with(prefix) {
                    continue;
                }
                let offscreen = item.CurrentIsOffscreen().is_ok_and(|off| off.as_bool());
                let center = (!offscreen)
                    .then(|| item.CurrentBoundingRectangle().ok())
                    .flatten()
                    .filter(|rect| rect.right > rect.left && rect.bottom > rect.top)
                    .map(|rect| POINT {
                        x: (rect.left + rect.right) / 2,
                        y: (rect.top + rect.bottom) / 2,
                    });
                let name = item
                    .CurrentName()
                    .map(|name| name.to_string())
                    .unwrap_or_default();
                rows.push(ListRow { id, name, center });
            }
        }
        Ok(Some(rows))
    }
}

pub(crate) fn click_in(window: HWND, at: POINT) -> bool {
    if unsafe { GetAncestor(WindowFromPoint(at), GA_ROOT) } != window {
        return false;
    }
    let back = window::cursor_position();
    if unsafe { SetCursorPos(at.x, at.y) }.is_err() {
        return false;
    }
    let input = |flags| INPUT {
        r#type: INPUT_MOUSE,
        Anonymous: INPUT_0 {
            mi: MOUSEINPUT {
                dwFlags: flags,
                ..Default::default()
            },
        },
    };
    let sent = unsafe {
        SendInput(
            &[input(MOUSEEVENTF_LEFTDOWN), input(MOUSEEVENTF_LEFTUP)],
            size_of::<INPUT>() as i32,
        )
    };
    std::thread::sleep(std::time::Duration::from_millis(50));
    if let Some(back) = back {
        let _ = unsafe { SetCursorPos(back.x, back.y) };
    }
    sent == 2
}
