import { Header, ThemeButton } from "./controls";
import { Scene, Ribbon } from "./scenes";

/** Original homepage structure and copy, rendered by React. CSS remains pinned. */
export default function Home({ logo }: { logo: string }) {
  return (
    <>
      {"\n    "}
      {"\n    "}
      <a className="skip" href="#main">
        {"跳到主要内容"}
      </a>
      {"\n    "}
      <svg
        width="0"
        height="0"
        className="sprite"
        aria-hidden="true"
        focusable="false"
      >
        {"\n      "}
        <symbol id="i-video" viewBox="0 0 24 24">
          <rect x="2.5" y="5.5" width="14" height="13" rx="2"></rect>
          <path d="m16.5 10.2 5-3v9.6l-5-3"></path>
        </symbol>
        {"\n      "}
        <symbol id="i-image" viewBox="0 0 24 24">
          <rect x="3" y="3" width="18" height="18" rx="2"></rect>
          <circle cx="9" cy="9" r="2"></circle>
          <path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"></path>
        </symbol>
        {"\n      "}
        <symbol id="i-audio" viewBox="0 0 24 24">
          <path d="M3 10v4M7 7v10M11 4v16M15 8v8M19 6v12"></path>
        </symbol>
        {"\n      "}
        <symbol id="i-chat" viewBox="0 0 24 24">
          <path d="M7.9 20A9 9 0 1 0 4 16.1L2.5 21.5Z"></path>
          <path d="M8.5 10.5h7M8.5 14h4.5"></path>
        </symbol>
        {"\n      "}
        <symbol id="i-canvas" viewBox="0 0 24 24">
          <rect x="3" y="3" width="7" height="7" rx="1.5"></rect>
          <rect x="14" y="3" width="7" height="7" rx="1.5"></rect>
          <rect x="14" y="14" width="7" height="7" rx="1.5"></rect>
          <rect x="3" y="14" width="7" height="7" rx="1.5"></rect>
        </symbol>
        {"\n      "}
        <symbol id="i-folder" viewBox="0 0 24 24">
          <path d="M3 7.5a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"></path>
        </symbol>
        {"\n      "}
        <symbol id="i-queue" viewBox="0 0 24 24">
          <path d="M4 6h16M4 12h10M4 18h13"></path>
        </symbol>
        {"\n      "}
        <symbol id="i-text" viewBox="0 0 24 24">
          <path d="M5 7V5h14v2M9.5 19h5M12 5v14"></path>
        </symbol>
        {"\n      "}
        <symbol id="i-film" viewBox="0 0 24 24">
          <rect x="3" y="3" width="18" height="18" rx="2"></rect>
          <path d="M7.5 3v18M16.5 3v18M3 7.5h4.5M3 12h18M3 16.5h4.5M16.5 7.5H21M16.5 16.5H21"></path>
        </symbol>
        {"\n      "}
        <symbol id="i-arrow" viewBox="0 0 24 24">
          <path d="M5 12h14m-6-6 6 6-6 6"></path>
        </symbol>
        {"\n      "}
        <symbol id="i-up" viewBox="0 0 24 24">
          <path d="M12 19V5m-6 6 6-6 6 6"></path>
        </symbol>
        {"\n      "}
        <symbol id="i-check" viewBox="0 0 24 24">
          <path d="M20 6 9 17l-5-5"></path>
        </symbol>
        {"\n      "}
        <symbol id="i-swap" viewBox="0 0 24 24">
          <path d="m16 3 4 4-4 4M20 7H5M8 21l-4-4 4-4M4 17h15"></path>
        </symbol>
        {"\n      "}
        <symbol id="i-users" viewBox="0 0 24 24">
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path>
          <circle cx="9" cy="7" r="4"></circle>
          <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"></path>
        </symbol>
        {"\n      "}
        <symbol id="i-moon" viewBox="0 0 24 24">
          <path d="M20.5 13.2A8.5 8.5 0 1 1 10.8 3.5a6.6 6.6 0 0 0 9.7 9.7Z"></path>
        </symbol>
        {"\n      "}
        <symbol id="i-sun" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="4"></circle>
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"></path>
        </symbol>
        {"\n      "}
        <symbol id="i-spark" viewBox="0 0 24 24">
          <path d="M12 2.5c.5 4.6 2.9 7 7.5 7.5-4.6.5-7 2.9-7.5 7.5-.5-4.6-2.9-7-7.5-7.5 4.6-.5 7-2.9 7.5-7.5Z"></path>
        </symbol>
        {"\n    "}
      </svg>
      {"\n\n    "}
      <Header id="top">
        {"\n      "}
        <div className="wrap top-row">
          {"\n        "}
          <a className="brand" href="/" aria-label="弗淼 AIGC 首页">
            <img src={logo} width="28" height="28" alt="" />
            <span>
              {"弗淼 "}
              <b>{"AIGC"}</b>
            </span>
          </a>
          {"\n        "}
          <nav className="nav" aria-label="页面导航">
            {"\n          "}
            <a href="#features">{"能力"}</a>
            {"\n          "}
            <a href="#workflow">{"制作流程"}</a>
            {"\n          "}
            <a href="#spaces">{"团队协作"}</a>
            {"\n        "}
          </nav>
          {"\n        "}
          <div className="top-actions">
            {"\n          "}
            <ThemeButton
              className="icon-button"
              type="button"
              data-act="theme"
              aria-label="切换浅色或深色外观"
            >
              {"\n            "}
              <svg className="icon only-light" aria-hidden="true">
                <use href="#i-moon"></use>
              </svg>
              {"\n            "}
              <svg className="icon only-dark" aria-hidden="true">
                <use href="#i-sun"></use>
              </svg>
              {"\n          "}
            </ThemeButton>
            {"\n          "}
            <a className="text-link guest-only" href="/studio#login">
              {"登录"}
            </a>
            {"\n          "}
            <a className="button primary small" href="/studio">
              {"进入工作台"}
            </a>
            {"\n        "}
          </div>
          {"\n      "}
        </div>
        {"\n    "}
      </Header>
      {"\n\n    "}
      <main id="main" tabIndex={-1}>
        {"\n      "}
        <section className="hero" aria-labelledby="hero-title">
          {"\n        "}
          <div className="wrap hero-grid">
            {"\n          "}
            <div className="hero-copy">
              {"\n            "}
              <p className="eyebrow">{"视频 · 图片 · 语音 · 画布"}</p>
              {"\n            "}
              <h1 id="hero-title">
                {"从一个想法，"}
                <br />
                {"到一支完整成片"}
              </h1>
              {"\n            "}
              <p className="lead">
                {
                  "弗淼 AIGC 是面向个人与团队的多模型创作工作台。写分镜、引用素材、生成镜头、配上旁白，再合成为可下载的成片，都在同一个网站里完成。"
                }
              </p>
              {"\n            "}
              <div className="cta-row">
                {"\n              "}
                <a className="button primary" href="/studio">
                  {"进入工作台"}
                  <svg className="icon" aria-hidden="true">
                    <use href="#i-arrow"></use>
                  </svg>
                </a>
                {"\n              "}
                <a
                  className="button secondary guest-only"
                  href="/studio#register"
                >
                  {"注册账户"}
                </a>
                {"\n            "}
              </div>
              {"\n            "}
              <p className="cta-note guest-only">
                {"注册需要管理员提供的邀请码。"}
              </p>
              {"\n            "}
              <p className="cta-note member-only">
                {"你已登录，可以直接回到工作台继续创作。"}
              </p>
              {"\n          "}
            </div>
            {"\n\n          "}
            <figure
              className="stage"
              aria-label="节点画布示意：文本节点连到图片节点，再连到视频节点"
            >
              {"\n            "}
              <div className="stage-bar" aria-hidden="true">
                {"\n              "}
                <img src={logo} width="18" height="18" alt="" />
                {"\n              "}
                <strong>{"示例画布"}</strong>
                {"\n              "}
                <span>{"节点 3"}</span>
                {"\n              "}
                <span className="saved">
                  <svg className="icon" aria-hidden="true">
                    <use href="#i-check"></use>
                  </svg>
                  {"已保存"}
                </span>
                {"\n            "}
              </div>
              {"\n            "}
              <svg
                className="links"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                {"\n              "}
                <path d="M31.5 46 C 35 46, 33 31, 37 31"></path>
                {"\n              "}
                <path d="M64.5 31 C 69 31, 66 52, 70 52"></path>
                {"\n            "}
              </svg>
              {"\n            "}
              <div className="node node-text" aria-hidden="true">
                {"\n              "}
                <span className="node-label">
                  <svg className="icon" aria-hidden="true">
                    <use href="#i-text"></use>
                  </svg>
                  {"分镜 1"}
                </span>
                {"\n              "}
                <div className="node-body">
                  {
                    "清晨的海边小站。镜头从窗外缓慢推近，暖光从窗内透出，海浪轻拍木栈道，节奏安静。"
                  }
                </div>
                {"\n            "}
              </div>
              {"\n            "}
              <div className="node node-image" aria-hidden="true">
                {"\n              "}
                <span className="node-label">
                  <svg className="icon" aria-hidden="true">
                    <use href="#i-image"></use>
                  </svg>
                  {"图片 1"}
                </span>
                {"\n              "}
                <div className="node-body media">
                  <Scene
                    className="scene"
                    data-scene="dawn"
                    viewBox="0 0 320 200"
                    preserveAspectRatio="xMidYMid slice"
                    index={1}
                  ></Scene>
                </div>
                {"\n            "}
              </div>
              {"\n            "}
              <div className="node node-video" aria-hidden="true">
                {"\n              "}
                <span className="node-label">
                  <svg className="icon" aria-hidden="true">
                    <use href="#i-film"></use>
                  </svg>
                  {"视频 1"}
                </span>
                {"\n              "}
                <div className="node-body media">
                  {"\n                "}
                  <Scene
                    className="scene"
                    data-scene="dusk"
                    viewBox="0 0 320 200"
                    preserveAspectRatio="xMidYMid slice"
                    index={2}
                  ></Scene>
                  {"\n                "}
                  <span className="duration">{"00:05"}</span>
                  {"\n              "}
                </div>
                {"\n            "}
              </div>
              {"\n            "}
              <div className="composer" aria-hidden="true">
                {"\n              "}
                <span className="composer-text">
                  {"引用「图片 1」，镜头缓慢推近…"}
                </span>
                {"\n              "}
                <span className="composer-params">
                  {"\n                "}
                  <span>
                    <svg className="icon" aria-hidden="true">
                      <use href="#i-video"></use>
                    </svg>
                    {"视频生成"}
                  </span>
                  {"\n                "}
                  <span>{"MiniMax H3"}</span>
                  {"\n                "}
                  <span className="hide-xs">{"16:9 · 480P"}</span>
                  {"\n                "}
                  <span className="hide-xs">{"5s"}</span>
                  {"\n              "}
                </span>
                {"\n              "}
                <span className="send">
                  <svg className="icon" aria-hidden="true">
                    <use href="#i-up"></use>
                  </svg>
                </span>
                {"\n            "}
              </div>
              {"\n            "}
              <figcaption className="sr-only">
                {"界面示意图，仅展示画布中节点与连线的关系，不含真实作品。"}
              </figcaption>
              {"\n          "}
            </figure>
            {"\n        "}
          </div>
          {"\n      "}
        </section>
        {"\n\n      "}
        <section
          className="section"
          id="features"
          aria-labelledby="features-title"
        >
          {"\n        "}
          <div className="wrap">
            {"\n          "}
            <div className="section-head">
              {"\n            "}
              <h2 id="features-title">
                {"视频、图片、语音和对话，共用一个工作台"}
              </h2>
              {"\n            "}
              <p>
                {
                  "提示词、参考素材和作品库贯穿每一种创作。可用模型由全站与团队设置决定，以工作台内显示为准。"
                }
              </p>
              {"\n          "}
            </div>
            {"\n          "}
            <ul className="features">
              {"\n            "}
              <li>
                {"\n              "}
                <svg className="icon feature-icon" aria-hidden="true">
                  <use href="#i-video"></use>
                </svg>
                {"\n              "}
                <h3>{"视频生成"}</h3>
                {"\n              "}
                <p>
                  {
                    "文字生成视频，或引用图片、视频、音频作为参考；可设置首帧与尾帧，选择画幅和时长。"
                  }
                </p>
                {"\n              "}
                <p className="tags">{"MiniMax H3 · Muse"}</p>
                {"\n            "}
              </li>
              {"\n            "}
              <li>
                {"\n              "}
                <svg className="icon feature-icon" aria-hidden="true">
                  <use href="#i-image"></use>
                </svg>
                {"\n              "}
                <h3>{"图片生成"}</h3>
                {"\n              "}
                <p>
                  {
                    "按提示词生成图片，或上传参考图再创作。常见图片格式会自动转换，拍摄方向自动校正。"
                  }
                </p>
                {"\n              "}
                <p className="tags">{"Muse"}</p>
                {"\n            "}
              </li>
              {"\n            "}
              <li>
                {"\n              "}
                <svg className="icon feature-icon" aria-hidden="true">
                  <use href="#i-audio"></use>
                </svg>
                {"\n              "}
                <h3>{"语音生成"}</h3>
                {"\n              "}
                <p>
                  {
                    "输入文字，再用一句话描述想要的音色，生成旁白音频并保存到资产库。"
                  }
                </p>
                {"\n              "}
                <p className="tags">{"Breeze TTS 2"}</p>
                {"\n            "}
              </li>
              {"\n            "}
              <li>
                {"\n              "}
                <svg className="icon feature-icon" aria-hidden="true">
                  <use href="#i-chat"></use>
                </svg>
                {"\n              "}
                <h3>{"AI 对话"}</h3>
                {"\n              "}
                <p>
                  {
                    "构思脚本、打磨文案、整理下一支视频的提示词；有用的回复可以放入画布继续制作。"
                  }
                </p>
                {"\n              "}
                <p className="tags">{"DeepSeek Flash"}</p>
                {"\n            "}
              </li>
              {"\n          "}
            </ul>
            {"\n          "}
            <ul className="extras">
              {"\n            "}
              <li>
                <svg className="icon" aria-hidden="true">
                  <use href="#i-canvas"></use>
                </svg>
                <div>
                  <strong>{"节点画布"}</strong>
                  <span>
                    {
                      "文本、图片、视频节点用连线传递提示词和有序参考图，结果回到节点，自动保存。"
                    }
                  </span>
                </div>
              </li>
              {"\n            "}
              <li>
                <svg className="icon" aria-hidden="true">
                  <use href="#i-folder"></use>
                </svg>
                <div>
                  <strong>{"资产库"}</strong>
                  <span>
                    {
                      "生成历史、收藏与分类，支持批量下载原文件；仍被引用的素材不会被误删。"
                    }
                  </span>
                </div>
              </li>
              {"\n            "}
              <li>
                <svg className="icon" aria-hidden="true">
                  <use href="#i-queue"></use>
                </svg>
                <div>
                  <strong>{"任务队列"}</strong>
                  <span>
                    {
                      "分开显示排队、准备、生成和回传，超出预计时如实显示仍在处理。"
                    }
                  </span>
                </div>
              </li>
              {"\n          "}
            </ul>
            {"\n        "}
          </div>
          {"\n      "}
        </section>
        {"\n\n      "}
        <section
          className="section section-alt"
          id="workflow"
          aria-labelledby="workflow-title"
        >
          {"\n        "}
          <div className="wrap flow-grid">
            {"\n          "}
            <div>
              {"\n            "}
              <div className="section-head">
                {"\n              "}
                <h2 id="workflow-title">{"从分镜到成片，一步接着一步"}</h2>
                {"\n              "}
                <p>
                  {
                    "每一步都保存在同一个画布项目里，前一步的结果直接成为下一步的输入。"
                  }
                </p>
                {"\n            "}
              </div>
              {"\n            "}
              <ol className="steps">
                {"\n              "}
                <li>
                  <span className="step-no">{"01"}</span>
                  <div>
                    <h3>{"分镜"}</h3>
                    <p>
                      {
                        "在画布中编排镜头，或让 AI 拟定 1—12 个镜头。先修改，再明确采用。"
                      }
                    </p>
                  </div>
                </li>
                {"\n              "}
                <li>
                  <span className="step-no">{"02"}</span>
                  <div>
                    <h3>{"素材"}</h3>
                    <p>
                      {
                        "把人物、服装、场景、风格或产品整理成素材包，每包最多九张有序图片；提交时固定所用版本。"
                      }
                    </p>
                  </div>
                </li>
                {"\n              "}
                <li>
                  <span className="step-no">{"03"}</span>
                  <div>
                    <h3>{"镜头"}</h3>
                    <p>
                      {"每个镜头一次生成一个或两个候选，提交前显示所需积分。"}
                    </p>
                  </div>
                </li>
                {"\n              "}
                <li>
                  <span className="step-no">{"04"}</span>
                  <div>
                    <h3>{"比较与采用"}</h3>
                    <p>
                      {
                        "并排比较候选画面和参数；已采用的版本不会被之后的生成替换。也可以提取当前帧作为下一个镜头的首帧。"
                      }
                    </p>
                  </div>
                </li>
                {"\n              "}
                <li>
                  <span className="step-no">{"05"}</span>
                  <div>
                    <h3>{"旁白"}</h3>
                    <p>
                      {"为每个镜头单独生成旁白；重新生成失败时保留原来的音轨。"}
                    </p>
                  </div>
                </li>
                {"\n              "}
                <li>
                  <span className="step-no">{"06"}</span>
                  <div>
                    <h3>{"成片"}</h3>
                    <p>
                      {
                        "按镜头顺序合成 MP4 预览，下载成片、SRT／VTT 字幕或原镜头包。"
                      }
                    </p>
                  </div>
                </li>
                {"\n            "}
              </ol>
              {"\n          "}
            </div>
            {"\n\n          "}
            <figure className="shots" aria-label="镜头列表界面示意">
              {"\n            "}
              <div className="panel-head" aria-hidden="true">
                <strong>{"镜头列表"}</strong>
                <span>{"4 个镜头"}</span>
              </div>
              {"\n            "}
              <ol className="shot-list" aria-hidden="true">
                {"\n              "}
                <li>
                  <span className="shot-no">{"1"}</span>
                  <Scene
                    className="thumb scene"
                    data-scene="dawn"
                    viewBox="0 0 320 200"
                    preserveAspectRatio="xMidYMid slice"
                    index={3}
                  ></Scene>
                  <div>
                    <strong>{"开场 · 远景"}</strong>
                    <span>{"旁白已生成 · 4 秒"}</span>
                  </div>
                  <span className="status done">{"已采用"}</span>
                </li>
                {"\n              "}
                <li>
                  <span className="shot-no">{"2"}</span>
                  <Scene
                    className="thumb scene"
                    data-scene="noon"
                    viewBox="0 0 320 200"
                    preserveAspectRatio="xMidYMid slice"
                    index={4}
                  ></Scene>
                  <div>
                    <strong>{"人物 · 中景"}</strong>
                    <span>{"旁白已生成 · 5 秒"}</span>
                  </div>
                  <span className="status done">{"已采用"}</span>
                </li>
                {"\n              "}
                <li>
                  <span className="shot-no">{"3"}</span>
                  <Scene
                    className="thumb scene"
                    data-scene="dusk"
                    viewBox="0 0 320 200"
                    preserveAspectRatio="xMidYMid slice"
                    index={5}
                  ></Scene>
                  <div>
                    <strong>{"细节 · 特写"}</strong>
                    <span>{"2 个候选待比较"}</span>
                  </div>
                  <span className="status">{"比较中"}</span>
                </li>
                {"\n              "}
                <li>
                  <span className="shot-no">{"4"}</span>
                  <span className="thumb empty">
                    <svg className="icon" aria-hidden="true">
                      <use href="#i-film"></use>
                    </svg>
                  </span>
                  <div>
                    <strong>{"收尾 · 拉远"}</strong>
                    <span>{"使用镜头 3 的末帧作为首帧"}</span>
                  </div>
                  <span className="status muted">{"待生成"}</span>
                </li>
                {"\n            "}
              </ol>
              {"\n            "}
              <div className="panel-foot" aria-hidden="true">
                {"\n              "}
                <div>
                  <strong>{"成片"}</strong>
                  <span>{"旁白替换对应镜头的原音轨，字幕按句分配时间。"}</span>
                </div>
                {"\n              "}
                <span className="fake-button">
                  <svg className="icon" aria-hidden="true">
                    <use href="#i-film"></use>
                  </svg>
                  {"合成预览"}
                </span>
                {"\n            "}
              </div>
              {"\n            "}
              <figcaption className="sr-only">
                {"界面示意图，镜头名称与状态仅为说明。"}
              </figcaption>
              {"\n          "}
            </figure>
            {"\n        "}
          </div>
          {"\n      "}
        </section>
        {"\n\n      "}
        <section className="section" id="spaces" aria-labelledby="spaces-title">
          {"\n        "}
          <div className="wrap spaces-grid">
            {"\n          "}
            <figure className="switcher" aria-label="工作区切换界面示意">
              {"\n            "}
              <div className="switch-trigger" aria-hidden="true">
                <span className="ws-badge team">
                  <svg className="icon" aria-hidden="true">
                    <use href="#i-users"></use>
                  </svg>
                </span>
                <strong>{"品牌内容组"}</strong>
                <svg className="icon" aria-hidden="true">
                  <use href="#i-swap"></use>
                </svg>
              </div>
              {"\n            "}
              <div className="switch-pop" aria-hidden="true">
                {"\n              "}
                <p className="pop-title">{"个人"}</p>
                {"\n              "}
                <div className="ws-row">
                  <span className="ws-badge me">{"我"}</span>
                  <div>
                    <strong>{"个人空间"}</strong>
                    <span>{"仅自己可见"}</span>
                  </div>
                </div>
                {"\n              "}
                <p className="pop-title">{"团队"}</p>
                {"\n              "}
                <div className="ws-row current">
                  <span className="ws-badge team">
                    <svg className="icon" aria-hidden="true">
                      <use href="#i-users"></use>
                    </svg>
                  </span>
                  <div>
                    <strong>{"品牌内容组"}</strong>
                    <span>{"团队成员共享"}</span>
                  </div>
                  <svg className="icon tick" aria-hidden="true">
                    <use href="#i-check"></use>
                  </svg>
                </div>
                {"\n              "}
                <div className="ws-row">
                  <span className="ws-badge team">
                    <svg className="icon" aria-hidden="true">
                      <use href="#i-users"></use>
                    </svg>
                  </span>
                  <div>
                    <strong>{"活动拍摄组"}</strong>
                    <span>{"团队成员共享"}</span>
                  </div>
                </div>
                {"\n            "}
              </div>
              {"\n            "}
              <figcaption className="sr-only">
                {"界面示意图，空间名称仅为说明。"}
              </figcaption>
              {"\n          "}
            </figure>
            {"\n\n          "}
            <div>
              {"\n            "}
              <div className="section-head">
                {"\n              "}
                <h2 id="spaces-title">{"个人空间与团队空间"}</h2>
                {"\n              "}
                <p>
                  {
                    "每个账号都有自己的个人空间；团队由管理员创建并分配成员。切换空间，就进入对应的作品和画布。"
                  }
                </p>
                {"\n            "}
              </div>
              {"\n            "}
              <ul className="rules">
                {"\n              "}
                <li>
                  <strong>{"个人内容只属于自己"}</strong>
                  <span>{"个人空间的作品、资产和对话仅本人可见。"}</span>
                </li>
                {"\n              "}
                <li>
                  <strong>{"团队内容共同使用"}</strong>
                  <span>
                    {"成员共享作品、画布、素材包和对话，使用团队共用积分。"}
                  </span>
                </li>
                {"\n              "}
                <li>
                  <strong>{"空间之间互不混用"}</strong>
                  <span>
                    {
                      "资产、任务、画布和草稿按空间隔离，参考素材不会跨空间流动。"
                    }
                  </span>
                </li>
                {"\n              "}
                <li>
                  <strong>{"权限和计费清楚"}</strong>
                  <span>
                    {
                      "模型同时受全站开关与团队权限控制；提交时冻结积分，失败或取消会退回。"
                    }
                  </span>
                </li>
                {"\n              "}
                <li>
                  <strong>{"多人编辑同一画布"}</strong>
                  <span>
                    {"自动保存并检查版本，发生冲突时不会覆盖他人的修改。"}
                  </span>
                </li>
                {"\n            "}
              </ul>
              {"\n          "}
            </div>
            {"\n        "}
          </div>
          {"\n      "}
        </section>
        {"\n\n      "}
        <section className="closing" aria-labelledby="closing-title">
          {"\n        "}
          <div className="wrap closing-row">
            {"\n          "}
            <Ribbon
              className="closing-ribbon"
              data-ribbon=""
              viewBox="0 0 480 200"
              preserveAspectRatio="xMidYMid slice"
              aria-hidden="true"
            ></Ribbon>
            {"\n          "}
            <div className="closing-copy">
              {"\n            "}
              <h2 id="closing-title">{"打开工作台，开始第一个镜头"}</h2>
              {"\n            "}
              <p className="guest-only">
                {"已有账户直接登录；还没有账户，可以使用邀请码注册。"}
              </p>
              {"\n            "}
              <p className="member-only">
                {"你的作品、画布和任务都在工作台里。"}
              </p>
              {"\n          "}
            </div>
            {"\n          "}
            <div className="cta-row">
              {"\n            "}
              <a className="button primary" href="/studio">
                {"进入工作台"}
                <svg className="icon" aria-hidden="true">
                  <use href="#i-arrow"></use>
                </svg>
              </a>
              {"\n            "}
              <a
                className="button secondary guest-only"
                href="/studio#register"
              >
                {"注册账户"}
              </a>
              {"\n          "}
            </div>
            {"\n        "}
          </div>
          {"\n      "}
        </section>
        {"\n    "}
      </main>
      {"\n\n    "}
      <footer className="foot">
        {"\n      "}
        <div className="wrap foot-row">
          {"\n        "}
          <a className="brand small" href="/" aria-label="弗淼 AIGC 首页">
            <img src={logo} width="22" height="22" alt="" />
            <span>
              {"弗淼 "}
              <b>{"AIGC"}</b>
            </span>
          </a>
          {"\n        "}
          <nav className="foot-links" aria-label="站点入口">
            {"\n          "}
            <a href="/studio">{"工作台"}</a>
            {"\n          "}
            <a className="guest-only" href="/studio#login">
              {"登录"}
            </a>
            {"\n          "}
            <a className="guest-only" href="/studio#register">
              {"注册"}
            </a>
            {"\n          "}
            <a href="#top">{"回到顶部"}</a>
            {"\n        "}
          </nav>
          {"\n      "}
        </div>
        {"\n    "}
      </footer>
      {"\n  "}
    </>
  );
}
