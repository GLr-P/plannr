import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, shot } from './helpers'

// Customers start with name, phone and email; business, address and linked people are added when needed.
// Tickets can be for the customer's business or for someone linked to them, and the lists show that.
test.describe.configure({ mode: 'serial' })

const dataDir = mkdtempSync(join(tmpdir(), 'plannr-e2e-linking-'))
let app: ElectronApplication
let page: Page
const nav = (name: string) => page.locator('.sidebar .nav-item', { hasText: name }).first()
const saved = () => expect(page.locator('.save-status')).toHaveAttribute('data-status', 'saved')

test.beforeAll(async () => {
  ;({ app, page } = await launch(dataDir))
})
test.afterAll(async () => {
  await app?.close()
})

test('a new customer is name, phone and email; Tab goes in that order and an email in the phone box moves over', async () => {
  await nav('Customers').click()
  await page.locator('.main').getByRole('button', { name: /New customer/ }).click()
  await expect(page.getByLabel('Customer name')).toBeFocused()
  await page.keyboard.type('Randy')
  await page.keyboard.press('Tab')
  await expect(page.getByLabel('Phone', { exact: true })).toBeFocused()
  await page.keyboard.type('randy@example.com') // wrong box
  await page.keyboard.press('Tab')
  await expect(page.getByLabel('Email', { exact: true })).toHaveValue('randy@example.com')
  await expect(page.getByLabel('Phone', { exact: true })).toHaveValue('')
  await page.getByLabel('Phone', { exact: true }).fill('250 555 0101')
  await expect(page.getByLabel('Business', { exact: true })).toHaveCount(0) // not until added
  await expect(page.getByLabel('Address', { exact: true })).toHaveCount(0)
  await saved()
  await shot(page, 'l1-new-customer')
})

test('+ Business and + Linked person add those sections; linking makes a new person', async () => {
  await page.locator('.add-chips').getByRole('button', { name: 'Business' }).click()
  await expect(page.getByLabel('Business', { exact: true })).toBeFocused()
  await page.keyboard.type('Ropate Refinishers')
  await page.locator('.add-chips').getByRole('button', { name: 'Linked person' }).click()
  await expect(page.getByLabel('Relation')).toBeFocused()
  await page.keyboard.type('Wife')
  await page.getByLabel('Link a person').fill('Jane')
  await expect(page.locator('.picker-menu .menu-item', { hasText: 'New customer “Jane”' })).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(page.locator('.linked-person')).toHaveCount(1)
  await expect(page.locator('.linked-person')).toContainText('Jane')
  await expect(page.locator('.linked-person')).toContainText('Wife')
  await saved()
  await shot(page, 'l2-customer-extras')
})

test('tickets can be for the business or for the wife', async () => {
  await page.locator('.main').getByRole('button', { name: 'New ticket', exact: true }).click()
  await expect(page.getByLabel('Customer name')).toHaveValue('Randy')
  await page.getByLabel('Title').fill('Business laptop')
  const forBox = page.getByLabel('Who it’s for')
  await expect(forBox.locator('option')).toHaveText(['Randy', 'Their business · Ropate Refinishers', 'Jane (Wife)', 'Someone else…'])
  await forBox.selectOption({ label: 'Their business · Ropate Refinishers' })
  await saved()

  await page.getByRole('button', { name: 'Open customer' }).click()
  await page.locator('.main').getByRole('button', { name: 'New ticket', exact: true }).click()
  await page.getByLabel('Title').fill('Aspire desktop')
  await page.getByLabel('Who it’s for').selectOption({ label: 'Jane (Wife)' })
  await saved()
  await expect(page.locator('.more-tickets')).toContainText('More for Randy')
  await expect(page.locator('.more-tickets .history-row')).toContainText('Business laptop')
  await shot(page, 'l3-ticket-for-wife')
})

test('the tickets list shows who each ticket is for, and can group by customer', async () => {
  await nav('Tickets').click()
  await expect(page.locator('.ticket-row', { hasText: 'Aspire desktop' })).toContainText('for Jane')
  await expect(page.locator('.ticket-row', { hasText: 'Business laptop' })).toContainText('Ropate Refinishers')
  await page.getByRole('button', { name: 'Group by customer' }).click()
  await expect(page.locator('.group-row')).toHaveCount(1)
  await expect(page.locator('.group-row')).toContainText('Randy · Ropate Refinishers · 2 tickets')
  await shot(page, 'l4-grouped-list')
  await page.getByRole('button', { name: 'Group by customer' }).click() // back to the plain list
  await expect(page.locator('.group-row')).toHaveCount(0)
})

test("customer pages split tickets by who they were for, and Jane's page shows the one on Randy's account", async () => {
  await nav('Customers').click()
  await page.locator('.customer-row', { hasText: 'Randy' }).click()
  await expect(page.locator('.history-group-label')).toHaveText(['Business · Ropate Refinishers', 'For Jane'])
  await page.locator('.linked-person', { hasText: 'Jane' }).click()
  await expect(page.getByLabel('Customer name')).toHaveValue('Jane')
  await expect(page.locator('.linked-person')).toContainText('Randy')
  await expect(page.locator('.linked-person')).toContainText('Wife of')
  await expect(page.locator('.history-group-label')).toHaveText(['On Randy’s account'])
  await expect(page.locator('.history-row')).toContainText('Aspire desktop')
  await shot(page, 'l5-wife-page')
})

test('search finds the ticket by who it is for', async () => {
  await nav('Tickets').click()
  await page.getByLabel('Search tickets').fill('Jane')
  await expect(page.locator('.ticket-row')).toHaveCount(1)
  await expect(page.locator('.ticket-row')).toContainText('Aspire desktop')
  await page.getByLabel('Search tickets').fill('')
})
