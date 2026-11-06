/** Button and Settings page copy. Field descriptions in the Host schema stay English. */
export const en: Record<string, string> = {
  nav: "Mobile",
  "settings.title": "Mobile",
  "settings.description":
    "Adds phone refinements on top of the Harness layout: the page fits above the on-screen keyboard, Enter adds a line, the keyboard stays closed until you tap the composer, and an edge swipe opens the navigation drawer that the Harness uses below 768px. Changes apply at once in every open page.",
  "settings.statusMobile": "The Harness is using its phone layout here ({width}px wide).",
  "settings.statusDesktop":
    "The Harness is using its desktop layout here ({width}px wide); it switches to the phone layout below 768px.",
  "settings.enterKey": "Enter key in the composer",
  "settings.enterKeyHint":
    "On a touch screen in the phone layout. With New line, send with the send button. IME conversion and command menus keep their Enter.",
  "settings.enterKey.newline": "New line",
  "settings.enterKey.send": "Send",
  "settings.autoFocusComposer": "Focus the composer automatically",
  "settings.autoFocusComposerHint":
    "Let a composer button or another Harness action focus the input and open the on-screen keyboard. Off keeps the keyboard closed until you tap the input.",
  "settings.swipe": "Swipe to open the sidebar",
  "settings.swipeHint":
    "Swipe right from the left edge to open the Harness navigation drawer, swipe left to close it.",
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
  nav: "移动端",
  "settings.title": "移动端",
  "settings.description":
    "在 Harness 布局之上补充手机体验：页面适配屏幕键盘上方的可见区域，Enter 换行，点按输入框之前不弹出键盘，屏幕窄于 768px 时从边缘滑动可打开 Harness 的导航抽屉。修改会立即应用到所有打开的页面。",
  "settings.statusMobile": "Harness 当前使用手机布局（宽 {width}px）。",
  "settings.statusDesktop":
    "Harness 当前使用桌面布局（宽 {width}px）；窄于 768px 时切换为手机布局。",
  "settings.enterKey": "输入框中的 Enter 键",
  "settings.enterKeyHint":
    "仅在触屏设备的手机布局中生效。选择换行时用发送按钮发送。输入法确认和命令菜单仍使用 Enter。",
  "settings.enterKey.newline": "换行",
  "settings.enterKey.send": "发送",
  "settings.autoFocusComposer": "自动聚焦输入框",
  "settings.autoFocusComposerHint":
    "按下输入框中的按钮或由 Harness 的其他操作把焦点移到输入框时，允许聚焦并弹出屏幕键盘。关闭时，点按输入框之前键盘不会弹出。",
  "settings.swipe": "滑动打开侧边栏",
  "settings.swipeHint": "从左边缘向右滑动打开 Harness 导航抽屉，向左滑动关闭。",
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
  nav: "モバイル",
  "settings.title": "モバイル",
  "settings.description":
    "Harness のレイアウトにスマートフォン向けの調整を足します。オンスクリーンキーボードの上に収まるようページを縮め、Enter で改行し、入力欄をタップするまでキーボードを開かず、768px 未満で使われる Harness のナビゲーションドロワーを画面端のスワイプで開閉できるようにします。変更は開いているすべてのページにすぐ反映されます。",
  "settings.statusMobile": "Harness はこのページでスマホ表示を使っています（幅 {width}px）。",
  "settings.statusDesktop":
    "Harness はこのページでデスクトップ表示を使っています（幅 {width}px）。768px 未満でスマホ表示に切り替わります。",
  "settings.enterKey": "入力欄の Enter キー",
  "settings.enterKeyHint":
    "タッチ端末のスマホ表示でだけ効きます。「改行」のときは送信ボタンで送ります。変換の確定とコマンドメニューでは従来どおり Enter が効きます。",
  "settings.enterKey.newline": "改行",
  "settings.enterKey.send": "送信",
  "settings.autoFocusComposer": "入力欄に自動でフォーカスする",
  "settings.autoFocusComposerHint":
    "入力欄のボタンや Harness のほかの操作で入力欄にフォーカスが移ったとき、そのままフォーカスしてキーボードを開きます。オフにすると、入力欄をタップするまでキーボードは開きません。",
  "settings.swipe": "スワイプでサイドバーを開く",
  "settings.swipeHint":
    "左端から右へスワイプで Harness のナビゲーションドロワーを開き、左へスワイプで閉じます。",
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
