function unique(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function encodeParams(params: Record<string, string>) {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) usp.set(k, v);
  return usp.toString();
}

function getRecordsByQuery(q: string) {
  const qs = encodeParams({ q, limit: "200", filters: "{}", timeRange: "" });
  return cy.request("GET", `/api/workspace/ops.inquiry/records?${qs}`).its("body.records");
}

function createRecord(data: Record<string, unknown>) {
  return cy.request("POST", "/api/workspace/ops.inquiry/records", { data }).its("body.id");
}

function deleteRecord(id: number) {
  return cy.request({ method: "DELETE", url: `/api/workspace/ops.inquiry/records/${id}`, failOnStatusCode: false });
}

describe("询价页（ops.inquiry）", () => {
  const adminUsername = Cypress.env("E2E_USERNAME") || Cypress.env("INITIAL_SUPER_ADMIN_USERNAME") || "admin";
  const adminPassword = Cypress.env("E2E_PASSWORD") || Cypress.env("INITIAL_SUPER_ADMIN_PASSWORD") || "StrongPass123";
  const assigneeUsername = Cypress.env("E2E_INQUIRY_ASSIGNEE_USERNAME") || "e2e_inquiry";
  const assigneePassword = Cypress.env("E2E_INQUIRY_ASSIGNEE_PASSWORD") || "StrongPass123";

  let category = "";
  let assignId = 0;
  let withdrawId = 0;
  let bulkEditId1 = 0;
  let bulkEditId2 = 0;
  let assignRule = "";
  let withdrawRule = "";
  let bulkRule = "";

  before(() => {
    cy.task("db:ensureAdmin", { username: String(adminUsername), password: String(adminPassword) });
    cy.task("db:ensureInquiryAssignee", { username: String(assigneeUsername), password: String(assigneePassword) });

    cy.login();

    category = unique("E2E类目");
    cy.request({ method: "POST", url: "/api/admin/categories", body: { name: category }, failOnStatusCode: false });

    assignRule = unique("pw-inquiry-assign");
    withdrawRule = unique("pw-inquiry-withdraw");
    bulkRule = unique("pw-inquiry-bulk");

    createRecord({
      名称: unique("E2E询价-待分配"),
      所属类目: category,
      产品规则: assignRule,
      状态: "待分配【询价】",
      "产品尺寸-长（厘米）": "10",
      "产品尺寸-宽（厘米）": "11",
      "产品尺寸-高（厘米）": "12",
      产品重量: "1",
      "单套尺寸-长（厘米）": "20",
      "单套尺寸-宽（厘米）": "21",
      "单套尺寸-高（厘米）": "22",
      "包裹实重（公斤）": "2",
    }).then((id) => {
      assignId = Number(id);
    });

    createRecord({
      名称: unique("E2E询价-可撤回"),
      所属类目: category,
      产品规则: withdrawRule,
      状态: "待询价",
    }).then((id) => {
      withdrawId = Number(id);
    });

    const bulkName = unique("E2E询价-批量修改");
    createRecord({
      名称: bulkName,
      所属类目: category,
      产品规则: bulkRule,
      状态: "待询价",
    }).then((id) => {
      bulkEditId1 = Number(id);
    });
    createRecord({
      名称: bulkName,
      所属类目: category,
      产品规则: bulkRule,
      状态: "待询价",
    }).then((id) => {
      bulkEditId2 = Number(id);
    });
  });

  after(() => {
    const ids = [assignId, withdrawId, bulkEditId1, bulkEditId2].filter((x) => Number.isFinite(x) && x > 0) as number[];
    ids.forEach((id) => deleteRecord(id));
  });

  it("字段展示正确：表头、格式化产品/单套属性", () => {
    cy.login();
    cy.visit("/work/ops/inquiry");

    cy.contains("th", "商品信息");
    cy.contains("th", "参考链接");
    cy.contains("th", "所属类目");
    cy.contains("th", "产品属性");
    cy.contains("th", "单套属性");
    cy.contains("th", "操作");

    cy.get('input[aria-label="全选"]').should("exist");

    cy.get('input[placeholder="商品名称"]').should("exist");
    cy.contains("div", "所属类目").parent().find("select").should("exist");

    cy.get('input[placeholder="商品名称"]').clear().type(assignRule);
    cy.contains("button", "查询").click();

    cy.get("tbody tr").should("have.length.at.least", 1);
    cy.get("tbody tr")
      .first()
      .within(() => {
        cy.contains("10x11x12cm");
        cy.contains("1kg");
        cy.contains("20x21x22cm");
        cy.contains("2kg");
        cy.contains("待分配【询价】");
      });
  });

  it("批量分配询价人：状态/字段落库（非缓存）", () => {
    cy.login();
    cy.visit("/work/ops/inquiry");

    cy.get('input[placeholder="商品名称"]').clear().type(assignRule);
    cy.contains("button", "查询").click();

    cy.get(`input[aria-label="选择 ID ${assignId}"]`).check();
    cy.contains("button", "批量分配询价人").should("not.be.disabled").click();

    cy.get('[data-edit-modal="inquiry-bulk-assign"]').should("be.visible").within(() => {
      cy.contains("div", "选择询价人").parent().find("select").select("E2E询价员");
      cy.contains("button", "确认分配").click();
    });

    getRecordsByQuery(assignRule).then((records) => {
      const row = (records as any[]).find((r) => Number(r.id) === assignId);
      expect(String(row?.data?.["状态"] ?? "")).to.eq("待询价");
      expect(String(row?.data?.["询价人"] ?? "")).to.eq(String(assigneeUsername));
    });
  });

  it("批量修改：修改字段并提交到待分配运营者（落库）", () => {
    cy.login();
    cy.visit("/work/ops/inquiry");

    cy.get('input[placeholder="商品名称"]').clear().type(bulkRule);
    cy.contains("button", "查询").click();

    cy.get(`input[aria-label="选择 ID ${bulkEditId1}"]`).check();
    cy.get(`input[aria-label="选择 ID ${bulkEditId2}"]`).check();

    cy.contains("button", "批量修改数据").should("not.be.disabled").click();
    cy.get('[data-edit-modal="inquiry-bulk-edit"]').should("be.visible").within(() => {
      cy.contains("div", "产品单价").parent().find("input").clear().type("9.9");
      cy.contains("div", "起订量").parent().find("input").clear().type("100");
      cy.contains("div", "单套尺寸（长 / 宽 / 高").parent().find("input").eq(0).clear().type("33");
      cy.contains("div", "单套尺寸（长 / 宽 / 高").parent().find("input").eq(1).clear().type("34");
      cy.contains("div", "单套尺寸（长 / 宽 / 高").parent().find("input").eq(2).clear().type("35");
      cy.contains("div", "包裹重量").parent().find("input").clear().type("3.3");
      cy.contains("button", "提交").click();
    });

    getRecordsByQuery(bulkRule).then((records) => {
      const ids = new Set([bulkEditId1, bulkEditId2].map((x) => Number(x)));
      const selected = (records as any[]).filter((r) => ids.has(Number(r.id)));
      expect(selected.length).to.eq(2);
      for (const r of selected) {
        expect(String(r.data?.["产品单价"] ?? "")).to.eq("9.9");
        expect(String(r.data?.["起订量"] ?? "")).to.eq("100");
        expect(String(r.data?.["单套尺寸-长（厘米）"] ?? "")).to.eq("33");
        expect(String(r.data?.["单套尺寸-宽（厘米）"] ?? "")).to.eq("34");
        expect(String(r.data?.["单套尺寸-高（厘米）"] ?? "")).to.eq("35");
        expect(String(r.data?.["包裹实重（公斤）"] ?? "")).to.eq("3.3");
        expect(String(r.data?.["状态"] ?? "")).to.eq("待分配运营者");
      }
    });
  });

  it("撤回：仅待询价可撤回，撤回理由必填且落库，状态回到待选品", () => {
    cy.login();
    cy.visit("/work/ops/inquiry");

    cy.get('input[placeholder="商品名称"]').clear().type(withdrawRule);
    cy.contains("button", "查询").click();

    cy.get("tbody tr").should("have.length.at.least", 1);
    cy.get("tbody tr")
      .first()
      .within(() => {
        cy.contains("button", "撤回").should("not.be.disabled").click();
      });

    cy.get('[data-edit-modal="inquiry-withdraw"]').should("be.visible").within(() => {
      cy.contains("button", "确定撤回").should("be.disabled");
      cy.get("textarea").type("E2E撤回理由");
      cy.contains("button", "确定撤回").click();
    });

    getRecordsByQuery(withdrawRule).then((records) => {
      const row = (records as any[]).find((r) => Number(r.id) === withdrawId);
      expect(String(row?.data?.["状态"] ?? "")).to.eq("待选品");
      expect(String(row?.data?.["撤回理由"] ?? "")).to.eq("E2E撤回理由");
    });
  });
});

