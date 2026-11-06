/** Button and Settings page copy. Field descriptions in the Host schema stay English. */
export const en: Record<string, string> = {
  "menu.open": "Open sidebar",
  "menu.close": "Close sidebar",
  nav: "Mobile",
  "settings.title": "Mobile",
  "settings.description":
    "Adapts the Web UI to phones: below the breakpoint the sidebar becomes a drawer, the page fits above the on-screen keyboard, and touch controls get larger targets. Changes apply at once in every open page.",
  "settings.statusMobile": "This page is using the phone layout ({width}px wide).",
  "settings.statusDesktop": "This page is using the desktop layout ({width}px wide).",
  "settings.mode": "Phone layout",
  "settings.modeHint":
    "Auto switches below the breakpoint. Off removes every change of this plugin.",
  "settings.mode.auto": "Auto",
  "settings.mode.always": "Always",
  "settings.mode.off": "Off",
  "settings.breakpoint": "Breakpoint",
  "settings.breakpointHint":
    "Viewport width in CSS pixels, from 360 to 1024. Below it, auto mode uses the phone layout. Most phones are 360 to 430 wide in portrait.",
  "settings.breakpointInvalid": "Enter a whole number from 360 to 1024.",
  "settings.enterKey": "Enter key in the composer",
  "settings.enterKeyHint":
    "On a touch screen in the phone layout. With New line, send with the send button. IME conversion and command menus keep their Enter.",
  "settings.enterKey.newline": "New line",
  "settings.enterKey.send": "Send",
  "settings.autoFocusComposer": "Focus the composer automatically",
  "settings.autoFocusComposerHint":
    "Opening a session or pressing a composer button focuses the input, as on desktop, and the on-screen keyboard opens. Off: tap the input to type.",
  "settings.swipe": "Swipe to open the sidebar",
  "settings.swipeHint": "Swipe right from the left edge to open, swipe left to close.",
  "settings.fitKeyboard": "Fit the page to the keyboard",
  "settings.fitKeyboardHint":
    "Keep the header and the composer on screen while the on-screen keyboard is up.",
  "settings.blockPullToRefresh": "Block pull-to-refresh",
  "settings.blockPullToRefreshHint":
    "Scrolling up past the top of a long conversation does not reload the page.",
  "settings.reset": "Restore defaults",
  "settings.unavailable": "This configuration is not available.",
  "settings.readOnly": "Configuration is read-only: a higher configuration layer sets it.",
  "settings.writeError": "The Host refused the change.",
}

export const zh: Record<string, string> = {
  "menu.open": "打开侧边栏",
  "menu.close": "关闭侧边栏",
  nav: "移动端",
  "settings.title": "移动端",
  "settings.description":
    "让 Web UI 适配手机：窄于断点时侧边栏变为抽屉，页面适配屏幕键盘上方的可见区域，触控控件的点击区域更大。修改会立即应用到所有打开的页面。",
  "settings.statusMobile": "当前页面使用手机布局（宽 {width}px）。",
  "settings.statusDesktop": "当前页面使用桌面布局（宽 {width}px）。",
  "settings.mode": "手机布局",
  "settings.modeHint": "自动：窄于断点时切换。关闭：撤销本插件的所有修改。",
  "settings.mode.auto": "自动",
  "settings.mode.always": "始终",
  "settings.mode.off": "关闭",
  "settings.breakpoint": "断点",
  "settings.breakpointHint":
    "视口宽度（CSS 像素），360 到 1024。窄于该值时自动模式使用手机布局。多数手机竖屏宽 360 到 430。",
  "settings.breakpointInvalid": "请输入 360 到 1024 之间的整数。",
  "settings.enterKey": "输入框中的 Enter 键",
  "settings.enterKeyHint":
    "仅在触屏设备的手机布局中生效。选择换行时用发送按钮发送。输入法确认和命令菜单仍使用 Enter。",
  "settings.enterKey.newline": "换行",
  "settings.enterKey.send": "发送",
  "settings.autoFocusComposer": "自动聚焦输入框",
  "settings.autoFocusComposerHint":
    "打开会话或按下输入框中的按钮时自动聚焦输入框（与桌面相同），屏幕键盘会弹出。关闭时点按输入框才开始输入。",
  "settings.swipe": "滑动打开侧边栏",
  "settings.swipeHint": "从左边缘向右滑动打开，向左滑动关闭。",
  "settings.fitKeyboard": "页面适配键盘",
  "settings.fitKeyboardHint": "屏幕键盘弹出时，标题栏和输入框保持在屏幕内。",
  "settings.blockPullToRefresh": "阻止下拉刷新",
  "settings.blockPullToRefreshHint": "在长会话顶部继续上滑不会刷新页面。",
  "settings.reset": "恢复默认",
  "settings.unavailable": "此配置不可用。",
  "settings.readOnly": "配置为只读：由更高的配置层设置。",
  "settings.writeError": "Host 拒绝了此修改。",
}

/** Used only while a Japanese language pack is active. */
export const ja: Record<string, string> = {
  "menu.open": "サイドバーを開く",
  "menu.close": "サイドバーを閉じる",
  nav: "モバイル",
  "settings.title": "モバイル",
  "settings.description":
    "Web UI をスマートフォンに合わせます。ブレークポイントより狭い画面ではサイドバーをドロワーにし、オンスクリーンキーボードの上に収まるようページを縮め、タッチ操作の当たり判定を広げます。変更は開いているすべてのページにすぐ反映されます。",
  "settings.statusMobile": "このページはスマホ表示です（幅 {width}px）。",
  "settings.statusDesktop": "このページはデスクトップ表示です（幅 {width}px）。",
  "settings.mode": "スマホ表示",
  "settings.modeHint":
    "自動はブレークポイントより狭いときに切り替えます。オフはこのプラグインの変更をすべて外します。",
  "settings.mode.auto": "自動",
  "settings.mode.always": "常に",
  "settings.mode.off": "オフ",
  "settings.breakpoint": "ブレークポイント",
  "settings.breakpointHint":
    "ビューポート幅（CSS ピクセル）。360〜1024 の範囲です。これより狭いと自動モードでスマホ表示になります。縦向きのスマホはおおむね 360〜430 です。",
  "settings.breakpointInvalid": "360〜1024 の整数を入力してください。",
  "settings.enterKey": "入力欄の Enter キー",
  "settings.enterKeyHint":
    "タッチ端末のスマホ表示でだけ効きます。「改行」のときは送信ボタンで送ります。変換の確定とコマンドメニューでは従来どおり Enter が効きます。",
  "settings.enterKey.newline": "改行",
  "settings.enterKey.send": "送信",
  "settings.autoFocusComposer": "入力欄に自動でフォーカスする",
  "settings.autoFocusComposerHint":
    "セッションを開いたときや入力欄のボタンを押したときに、デスクトップと同じく入力欄にフォーカスし、キーボードが開きます。オフにすると、入力欄をタップするまでキーボードは開きません。",
  "settings.swipe": "スワイプでサイドバーを開く",
  "settings.swipeHint": "左端から右へスワイプで開き、左へスワイプで閉じます。",
  "settings.fitKeyboard": "キーボードに合わせてページを縮める",
  "settings.fitKeyboardHint":
    "オンスクリーンキーボードの表示中も、ヘッダーと入力欄を画面内に残します。",
  "settings.blockPullToRefresh": "引っ張って更新を止める",
  "settings.blockPullToRefreshHint":
    "長い会話の先頭でさらに上へスクロールしても再読み込みしません。",
  "settings.reset": "既定値に戻す",
  "settings.unavailable": "この設定は利用できません。",
  "settings.readOnly": "上位の設定レイヤーが値を決めているため、読み取り専用です。",
  "settings.writeError": "Host が変更を拒否しました。",
}
