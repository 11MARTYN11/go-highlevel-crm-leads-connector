/**
 * GitHub to Go High Level Data Mapper
 * Transforms GitHub event data into GHL contact/lead format
 */

import { GHLContact } from '../gohighlevel/client.js';
import { getMapping, EventMapping } from '../config/field-mappings.js';
import logger from '../config/logger.js';

export interface GitHubUser {
  login: string;
  id: number;
  name?: string;
  email?: string;
  avatar_url?: string;
  profile_url?: string;
}

export interface GitHubEvent {
  action?: string;
  pull_request?: any;
  issue?: any;
  discussion?: any;
  comment?: any;
  push?: any;
  repository?: {
    name: string;
    full_name: string;
    html_url: string;
  };
  sender?: GitHubUser;
  pusher?: {
    name: string;
    email: string;
  };
  [key: string]: any;
}

/**
 * Deep get object value by path (e.g., "user.email")
 */
function getValueByPath(obj: any, path: string): any {
  return path.split('.').reduce((current, prop) => current?.[prop], obj);
}

/**
 * Extract email from GitHub user
 * GitHub API may not return email in all cases
 */
function extractEmail(user?: GitHubUser, fallbackDomain = 'github.local'): string {
  if (user?.email) return user.email;
  if (user?.login) return `${user.login}@${fallbackDomain}`;
  return `unknown@${fallbackDomain}`;
}

/**
 * Extract name from GitHub user
 */
function extractName(user?: GitHubUser): { firstName: string; lastName: string } {
  let firstName = '';
  let lastName = '';

  if (user?.name) {
    const parts = user.name.split(' ');
    firstName = parts[0] || '';
    lastName = parts.slice(1).join(' ') || '';
  } else if (user?.login) {
    firstName = user.login;
  }

  return { firstName, lastName };
}

/**
 * Map GitHub Pull Request event to GHL Contact
 */
export function mapPullRequestToLead(event: GitHubEvent): GHLContact | null {
  try {
    if (!event.pull_request?.user) return null;

    const user = event.pull_request.user;
    const { firstName, lastName } = extractName(user);
    const email = extractEmail(user);

    const lead: GHLContact = {
      firstName,
      lastName,
      email,
      phone: '',
      companyName: `GitHub: ${user.login}`,
      locationId: '', // Will be set by client
      tags: ['github-pr', 'developer'],
      customFields: {
        githubUsername: user.login,
        githubRepositoryName: event.repository?.name || 'unknown',
        githubPRTitle: event.pull_request.title || '',
        githubPRUrl: event.pull_request.html_url || '',
        githubAction: event.action || 'opened',
      },
    };

    logger.debug({ email }, 'Mapped PR event to lead');
    return lead;
  } catch (error) {
    logger.error({ error, event }, 'Failed to map PR event');
    return null;
  }
}

/**
 * Map GitHub Issue event to GHL Contact
 */
export function mapIssueToLead(event: GitHubEvent): GHLContact | null {
  try {
    if (!event.issue?.user) return null;

    const user = event.issue.user;
    const { firstName, lastName } = extractName(user);
    const email = extractEmail(user);

    const lead: GHLContact = {
      firstName,
      lastName,
      email,
      phone: '',
      companyName: `GitHub: ${user.login}`,
      locationId: '',
      tags: ['github-issue', 'feedback'],
      customFields: {
        githubUsername: user.login,
        githubRepositoryName: event.repository?.name || 'unknown',
        githubIssueTitle: event.issue.title || '',
        githubIssueUrl: event.issue.html_url || '',
        githubIssueNumber: String(event.issue.number),
        githubAction: event.action || 'opened',
      },
    };

    logger.debug({ email }, 'Mapped Issue event to lead');
    return lead;
  } catch (error) {
    logger.error({ error, event }, 'Failed to map Issue event');
    return null;
  }
}

/**
 * Map GitHub Discussion event to GHL Contact
 */
export function mapDiscussionToLead(event: GitHubEvent): GHLContact | null {
  try {
    if (!event.discussion?.user) return null;

    const user = event.discussion.user;
    const { firstName, lastName } = extractName(user);
    const email = extractEmail(user);

    const lead: GHLContact = {
      firstName,
      lastName,
      email,
      phone: '',
      companyName: `GitHub: ${user.login}`,
      locationId: '',
      tags: ['github-discussion', 'community'],
      customFields: {
        githubUsername: user.login,
        githubRepositoryName: event.repository?.name || 'unknown',
        githubDiscussionTitle: event.discussion.title || '',
        githubDiscussionUrl: event.discussion.html_url || '',
      },
    };

    logger.debug({ email }, 'Mapped Discussion event to lead');
    return lead;
  } catch (error) {
    logger.error({ error, event }, 'Failed to map Discussion event');
    return null;
  }
}

/**
 * Map GitHub Push event to activity data
 */
export function mapPushToActivity(event: GitHubEvent): { email: string; note: string } | null {
  try {
    if (!event.pusher) return null;

    const pusherEmail = event.pusher.email || extractEmail(undefined);
    const branchName = event.ref?.split('/').pop() || 'unknown';
    const commitCount = event.commits?.length || 0;

    const note = `Pushed ${commitCount} commit${commitCount > 1 ? 's' : ''} to branch "${branchName}" in ${event.repository?.name}`;

    logger.debug({ email: pusherEmail }, 'Mapped Push event to activity');
    return { email: pusherEmail, note };
  } catch (error) {
    logger.error({ error, event }, 'Failed to map Push event');
    return null;
  }
}

/**
 * Map GitHub Comment event to activity data
 */
export function mapCommentToActivity(event: GitHubEvent): { email: string; note: string } | null {
  try {
    if (!event.comment?.user) return null;

    const user = event.comment.user;
    const email = extractEmail(user);
    const comment = event.comment.body || '';
    const context = event.issue?.title || event.pull_request?.title || 'GitHub';

    const note = `Commented on "${context}": ${comment.substring(0, 100)}${comment.length > 100 ? '...' : ''}`;

    logger.debug({ email }, 'Mapped Comment event to activity');
    return { email, note };
  } catch (error) {
    logger.error({ error, event }, 'Failed to map Comment event');
    return null;
  }
}

/**
 * Main mapper function - routes events to appropriate mappers
 */
export function mapGitHubEventToLead(eventType: string, event: GitHubEvent): GHLContact | null {
  const mapping = getMapping(eventType);

  if (!mapping) {
    logger.warn({ eventType }, 'No mapping found for event type');
    return null;
  }

  // Filter by action if specified
  if (event.action && !shouldProcessAction(eventType, event.action)) {
    logger.debug({ eventType, action: event.action }, 'Skipping event based on action filter');
    return null;
  }

  switch (eventType) {
    case 'pull_request':
      return mapPullRequestToLead(event);
    case 'issues':
      return mapIssueToLead(event);
    case 'discussion':
      return mapDiscussionToLead(event);
    default:
      logger.warn({ eventType }, 'Unmapped event type');
      return null;
  }
}

/**
 * Determine if we should process this GitHub action
 */
function shouldProcessAction(eventType: string, action: string): boolean {
  const processableActions: Record<string, string[]> = {
    pull_request: ['opened', 'reopened', 'synchronize'],
    issues: ['opened', 'reopened'],
    discussion: ['created'],
  };

  const allowed = processableActions[eventType] || [];
  return allowed.includes(action);
}
