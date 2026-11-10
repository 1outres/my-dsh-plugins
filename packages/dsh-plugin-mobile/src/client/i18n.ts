/** Button and Settings page copy. Field descriptions in the Host schema stay English. */
export const en: Record<string, string> = {
  nav: "Mobile",
  "settings.title": "Mobile",
  "settings.description":
    "Adds phone refinements on top of the Harness layout: the page fits above the on-screen keyboard, Enter adds a line, the keyboard stays closed until you tap the composer, and an edge swipe opens the navigation drawer that the Harness uses below 768px. It also makes the Web UI installable, shows an offline page when the Host cannot be reached, and registers the service worker that push notifications use. Changes apply at once in every open page.",
  "settings.statusMobile": "The Harness is using its phone layout here ({width}px wide).",
  "settings.statusDesktop":
    "The Harness is using its desktop layout here ({width}px wide); it switches to the phone layout below 768px.",
  "settings.app": "App",
  "settings.appInstalled": "Installed app",
  "settings.appBrowser": "Browser tab",
  "settings.workerStatus": "Service worker",
  "settings.worker.unsupported": "not supported by this browser",
  "settings.worker.insecure": "needs HTTPS or localhost",
  "settings.worker.off": "off",
  "settings.worker.registering": "starting",
  "settings.worker.ready": "ready",
  "settings.worker.failed": "failed to start",
  "settings.install": "Install app",
  "settings.installHint": "Open the Share menu and choose Add to Home Screen",
  "settings.serviceWorker": "Service worker",
  "settings.serviceWorkerHint":
    "Register the app's service worker: it shows an offline page when the Host cannot be reached and delivers push notifications (used by the notify plugin). Off unregisters it.",
  "settings.themeColor": "Color the title bar",
  "settings.themeColorHint":
    "Paint the browser and installed-app title bar in the page background color, following the light or dark theme.",
  "settings.pushHint": "Push notifications on iPhone and iPad need the app on the Home Screen.",
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
    "在 Harness 布局之上补充手机体验：页面适配屏幕键盘上方的可见区域，Enter 换行，点按输入框之前不弹出键盘，屏幕窄于 768px 时从边缘滑动可打开 Harness 的导航抽屉。同时让 Web UI 可安装，无法连接 Host 时显示离线页面，并注册推送通知使用的 Service Worker。修改会立即应用到所有打开的页面。",
  "settings.statusMobile": "Harness 当前使用手机布局（宽 {width}px）。",
  "settings.statusDesktop":
    "Harness 当前使用桌面布局（宽 {width}px）；窄于 768px 时切换为手机布局。",
  "settings.app": "应用",
  "settings.appInstalled": "已安装的应用",
  "settings.appBrowser": "浏览器标签页",
  "settings.workerStatus": "Service Worker",
  "settings.worker.unsupported": "此浏览器不支持",
  "settings.worker.insecure": "需要 HTTPS 或 localhost",
  "settings.worker.off": "已关闭",
  "settings.worker.registering": "正在启动",
  "settings.worker.ready": "就绪",
  "settings.worker.failed": "启动失败",
  "settings.install": "安装应用",
  "settings.installHint": "打开共享菜单，选择“添加到主屏幕”",
  "settings.serviceWorker": "Service Worker",
  "settings.serviceWorkerHint":
    "注册应用的后台脚本：无法连接 Host 时显示离线页面，并送达推送通知（由 notify 插件使用）。关闭后会注销。",
  "settings.themeColor": "为标题栏着色",
  "settings.themeColorHint": "用页面背景色填充浏览器和已安装应用的标题栏，并跟随浅色或深色主题。",
  "settings.pushHint": "iPhone 和 iPad 上的推送通知需要先把应用添加到主屏幕。",
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
    "Harness のレイアウトにスマートフォン向けの調整を足します。オンスクリーンキーボードの上に収まるようページを縮め、Enter で改行し、入力欄をタップするまでキーボードを開かず、768px 未満で使われる Harness のナビゲーションドロワーを画面端のスワイプで開閉できるようにします。さらに Web UI をインストール可能にし、Host に接続できないときはオフラインページを表示し、プッシュ通知が使う Service Worker を登録します。変更は開いているすべてのページにすぐ反映されます。",
  "settings.statusMobile": "Harness はこのページでスマホ表示を使っています（幅 {width}px）。",
  "settings.statusDesktop":
    "Harness はこのページでデスクトップ表示を使っています（幅 {width}px）。768px 未満でスマホ表示に切り替わります。",
  "settings.app": "アプリ",
  "settings.appInstalled": "インストール済みアプリ",
  "settings.appBrowser": "ブラウザのタブ",
  "settings.workerStatus": "Service Worker",
  "settings.worker.unsupported": "このブラウザでは使えません",
  "settings.worker.insecure": "HTTPS か localhost が必要です",
  "settings.worker.off": "オフ",
  "settings.worker.registering": "起動中",
  "settings.worker.ready": "準備完了",
  "settings.worker.failed": "起動に失敗しました",
  "settings.install": "アプリをインストール",
  "settings.installHint": "共有メニューを開き、「ホーム画面に追加」を選びます",
  "settings.serviceWorker": "Service Worker",
  "settings.serviceWorkerHint":
    "アプリの Service Worker を登録します。Host に接続できないときはオフラインページを表示し、プッシュ通知を届けます（notify プラグインが使います）。オフにすると登録を解除します。",
  "settings.themeColor": "タイトルバーを着色",
  "settings.themeColorHint":
    "ブラウザとインストール済みアプリのタイトルバーをページの背景色で塗り、ライトテーマとダークテーマに合わせます。",
  "settings.pushHint":
    "iPhone と iPad のプッシュ通知には、アプリをホーム画面に追加する必要があります。",
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
