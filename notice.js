/* ============================================================
   公告配置 —— 想发新公告只改这个文件，不用动 index.html。
   规则：
   - enabled: false 一键关掉弹窗
   - id: 换一个新值（如 'activity2026cny'）就会对所有人重新弹一次
   - frequency: 'once'   新 id 弹一次（默认，适合版本公告）
                'daily'  每个玩家每天弹一次（适合限时活动）
                'always' 每次进游戏都弹（慎用，容易烦人）
   - title / body: 双语写 { zh:'', en:'' }；只写一种语言就直接给字符串
   - body 里的 \n 是换行
   - img:（图放仓库里用相对路径，如 'naiwa/over/naihao.webp'）
   - end:（可选）失效日期 'YYYY-MM-DD'，该日 0 点起不再弹 —— 限时活动到点自动下线
   - btn:   可选跳转按钮 { text:{zh:'',en:''}, url:'https://...' }，不需要就 null
   ============================================================ */
window.XXL_NOTICE = {
  enabled: true,
  id: 'cny2026',
  frequency: 'always',
  title: { zh:'公告', en:'Notice' },
  body: {
    zh:'祝大家国庆快乐！也可以进奶蛙消消乐的粉丝群一起来聊天哦',
    en:'Happy National Day! Come join the Milk Frog Match fan group and chat with us'
  },
  img: 'naiwa/about/fsq2.webp',
  end: '2026-10-08',               /* 国庆活动：10 月 8 日起自动停弹 */
  btn: null
};
