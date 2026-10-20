# 橡塑展参展商前台 · 需求文档（供 DeepSeek 生成反例）

## 一、业务背景

展商从主办方 CPS27 eForm 的链接进入（`param=CPS27EFORM_{CID}_{TIMEKEY}_{EQTIMEKEY}`），
系统免登获取展商资料 → 展商确认/补充联系人信息 → 注册或登录 → 进入首页浏览商品、下单租赁 → 缴费 → 申请发票。

展位归属机构（agency）来自展会；租户（tenant）生产固定 **358**。

## 二、接口与校验规则

### 1. 免登入口 `GET /login/getBaseInfo`
- `param` 必填，格式 `CPS27EFORM_{CID}_{TIMEKEY}_{EQTIMEKEY}`；缺失/格式非法应 400。
- `exhibitionId` 必填；缺失应 400。
- 成功返回 `agencyId / tenantId / basicInfo / booth / boundUsers`。
- 取不到展商资料时返回业务错误（非 500）。

### 2. 注册/登录 `POST /login/syncLogin`
- **`param` 必填**（与 `getBaseInfo` 相同的 CPS27 链接串）：服务端靠它匹配展位，缺失会返回
  `code=1「未匹配到参展商信息，请通过正规入口进入」`。
- `userPhone / exhibitionId / expoId` 必填；`companyId`、`boothNo` 建议从 `getBaseInfo` 的
  `$.basicInfo.companyId`、`$.booth.exnum` 取到后一起传，缺失/空串应 400。
- 也兼容通过 `boothNo` / `userPhone` / `userEmail` 反查展位（优先级低于 `param`）。
- `userPhone` 作为登录名：已存在则直接登录；不存在则注册。
- 邮箱规则：
  - 手机号已存在时，本次邮箱必须与已绑定邮箱一致，否则拒绝（邮箱不可自行修改，需联系管理员）；
  - 邮箱已被其它手机号绑定 → 拒绝注册并提示更换。
- 新账号：`tenant_id=358`，`agency_id`=展会所属机构。
- 返回 `token`（JWT）、`agencyId`、`tenantId`、`basicInfo`、`booth`。

### 3. 首页 `GET /home/homePage`
- `expoId` 或 `exhibitionId` 传一个；都为空应 400。
- 未登录/伪造 token 应 401。

### 4. 商品 `GET /home/getGoods`
- `exhibitionId`、`boothId` 必填；缺失应 400。
- `offset` 为**行偏移（0 起）**，负数/非数字应被拒绝或纠正。
- 仅返回启用（`is_enable=0`）且库存 > 0 的商品。

### 5. 商品类型 `GET /home/listMaterialType`
- `boothId`、`exhibitionId` 必填。

### 6. 提交订单 `POST /home/submitOrder`
- `shopCartVos` 必填且非空；每项 `goodsId`、`buyNum(>=1)`、`boothId`、`exNum`。
- `buyNum` 为 0、负数、超出库存应拒绝。
- 未登录下单应 401。
- 一次提交只允许生成一笔订单；购物车不得混入其它展位残留商品（服务端按展位拆单）。
- `tradeWay` 不传时默认线下汇款。

### 7. 订单查询 `GET /home/getOrder` / `GET /home/getOrderList`
- `getOrder` 的 `id` 必填且为整数。
- 列表按登录人过滤，不能查到他人订单；未登录 401。

### 8. 楣板/会刊 `GET /home/listFascias` / `POST /home/saveBookletOrFascia`
- 列表：`expoId`/`exhibitionId` 至少一个，否则 400。
- 保存：`boothId`、`exhibitionId` 必填；公司名超长应拒绝。

### 9. 支付 `GET /home/getPayWays` / `POST /home/payOrder` / `POST /home/printPayment`
- `getPayWays`：`exhibitionId` 必填。
- `payOrder`：`payWays` 必填非空。
- `printPayment`：`requestNum` 必填。

### 10. 发票 `/invoice/apply/*`
- `getExList`、`selectApplyInvoiceOrderList`、`invoiceCount`：`exhibitionId` 必填。
- `checkCode`：`orderHeaderId`、`remitCode`、`checkRemitCode` 必填；汇款码不匹配应拒绝。
- `getSysConfigByKey`：`key` 必填。
- `image/remove`：`dataId`、`type` 必填，`type` 必须是合法图片类型。
- 提交开票：专票必填税号/开户行/账号/地址/电话；金额不得为 0 或负数。

## 三、重点反例方向

| 分类 | 举例 |
|---|---|
| 必填缺失 | `userPhone`、`param`、`exhibitionId`、`boothId`、`requestNum`、`key` 不传 |
| 类型错误 | `buyNum` 传字符串、`area` 传数组、`shopCartVos` 传对象、`offset` 传 `"abc"` |
| 边界溢出 | `buyNum=0/-1/999999`、`offset=-1`、超长手机号/邮箱/公司名 |
| 空值空串 | `userPhone=""`、`userEmail="   "`、`shopCartVos=[]`、`expoId=""` |
| 安全注入 | `param` 带 `' OR 1=1 --`、`<script>`、`../../etc/passwd` |
| 业务规则 | 邮箱与已绑定不一致、邮箱被占用、未登录下单、混合展位下单、非法 `srcType` |

## 四、测试数据约束

- 使用测试展会 `ec21dfb67eeb4669ace30802f6aa3aab` 与其展位，禁止使用生产展位号。
- `submitOrder`、`syncLogin`、`saveBookletOrFascia`、`/invoice/apply` 会写库，请使用测试账号与可回收数据。
