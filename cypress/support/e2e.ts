declare global {
  namespace Cypress {
    interface Chainable {
      login(): Chainable<void>;
    }
  }
}

Cypress.Commands.add("login", () => {
  const username = Cypress.env("E2E_USERNAME") || Cypress.env("INITIAL_SUPER_ADMIN_USERNAME") || "admin";
  const password = Cypress.env("E2E_PASSWORD") || Cypress.env("INITIAL_SUPER_ADMIN_PASSWORD") || "StrongPass123";

  cy.session(
    ["login", username],
    () => {
      cy.visit("/auth/login");
      cy.get('input[autocomplete="username"]').clear().type(String(username));
      cy.get('input[type="password"][autocomplete="current-password"]').clear().type(String(password), { log: false });
      cy.contains("button", "登录").click();
      cy.location("pathname", { timeout: 120000 }).should("include", "/work");
    },
    { cacheAcrossSpecs: true },
  );
});

export {};

