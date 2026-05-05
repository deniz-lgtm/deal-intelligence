// Legacy compatibility route.
// Keep /api/chat alive for any old client links, but run all conversation
// traffic through the universal assistant so history, tools, and playbook
// context stay in one place.
export { dynamic, POST, GET, DELETE } from "../universal-chat/route";
