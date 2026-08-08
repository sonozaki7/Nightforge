import crypto from "node:crypto";
import pino from "pino";

const logger = pino({ name: "nightforge-linear" });

const LINEAR_API_URL = "https://api.linear.app/graphql";

export interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  priority: number;
  labels: string[];
  stateName: string;
  teamId: string | null;
  teamName: string | null;
}

export interface LinearTeam {
  id: string;
  name: string;
}

export interface LinearClient {
  verifyWebhookSignature(
    payload: string,
    signature: string,
    secret: string
  ): boolean;
  getIssue(issueId: string): Promise<LinearIssue | null>;
  getChildIssues(parentIssueId: string): Promise<LinearIssue[]>;
  postComment(issueId: string, body: string): Promise<void>;
  updateIssueState(issueId: string, stateName: string): Promise<void>;
  listTeams(): Promise<LinearTeam[]>;
  createTeam(name: string): Promise<LinearTeam>;
  createWebhook(input: {
    teamId: string;
    url: string;
    label: string;
    secret: string;
  }): Promise<void>;
  listWebhooks(
    teamId: string
  ): Promise<Array<{ id: string; label: string; resourceTypes: string[] }>>;
  updateWebhook(input: {
    webhookId: string;
    resourceTypes: string[];
  }): Promise<void>;
  createIssue(input: {
    teamId: string;
    title: string;
    description: string;
    stateId?: string;
  }): Promise<void>;
  archiveIssue(issueId: string): Promise<void>;
  listTeamIssues(
    teamId: string
  ): Promise<Array<{ id: string; title: string }>>;
  listTeamStates(
    teamId: string
  ): Promise<Array<{ id: string; name: string; type: string }>>;
}

export function createLinearClient(apiKey: string): LinearClient {
  const graphqlRequest = async <T>(
    query: string,
    variables: Record<string, unknown>
  ): Promise<T> => {
    const response = await fetch(LINEAR_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: apiKey,
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      throw new Error(`Linear API error: ${String(response.status)}`);
    }

    const result = (await response.json()) as {
      data?: T;
      errors?: Array<{ message: string }>;
    };

    if (result.errors && result.errors.length > 0) {
      throw new Error(`Linear GraphQL error: ${result.errors[0]?.message}`);
    }

    if (!result.data) {
      throw new Error("Linear API returned no data");
    }

    return result.data;
  };

  return {
    verifyWebhookSignature(
      payload: string,
      signature: string,
      secret: string
    ): boolean {
      const expectedSignature = crypto
        .createHmac("sha256", secret)
        .update(payload)
        .digest("hex");
      const provided = Buffer.from(signature);
      const expected = Buffer.from(expectedSignature);
      // timingSafeEqual throws on length mismatch; a malformed signature
      // must simply be rejected, not crash the webhook handler.
      if (provided.length !== expected.length) {
        return false;
      }
      return crypto.timingSafeEqual(provided, expected);
    },

    async getIssue(issueId: string): Promise<LinearIssue | null> {
      const query = `
        query GetIssue($id: String!) {
          issue(id: $id) {
            id
            identifier
            title
            description
            priority
            state {
              name
            }
            team {
              id
              name
            }
            labels {
              nodes {
                name
              }
            }
          }
        }
      `;

      try {
        const data = await graphqlRequest<{
          issue: {
            id: string;
            identifier: string;
            title: string;
            description: string | null;
            priority: number;
            state: { name: string };
            team: { id: string; name: string } | null;
            labels: { nodes: Array<{ name: string }> };
          };
        }>(query, { id: issueId });

        return {
          id: data.issue.id,
          identifier: data.issue.identifier,
          title: data.issue.title,
          description: data.issue.description,
          priority: data.issue.priority,
          stateName: data.issue.state.name,
          teamId: data.issue.team?.id ?? null,
          teamName: data.issue.team?.name ?? null,
          labels: data.issue.labels.nodes.map((l) => l.name),
        };
      } catch (err) {
        logger.error({ err, issueId }, "Failed to get issue");
        return null;
      }
    },

    async getChildIssues(parentIssueId: string): Promise<LinearIssue[]> {
      const query = `
        query GetChildIssues($id: String!) {
          issue(id: $id) {
            children {
              nodes {
                id
                identifier
                title
                description
                priority
                state {
                  name
                }
                team {
                  id
                  name
                }
                labels {
                  nodes {
                    name
                  }
                }
              }
            }
          }
        }
      `;

      try {
        const data = await graphqlRequest<{
          issue: {
            children: {
              nodes: Array<{
                id: string;
                identifier: string;
                title: string;
                description: string | null;
                priority: number;
                state: { name: string };
                team: { id: string; name: string } | null;
                labels: { nodes: Array<{ name: string }> };
              }>;
            };
          };
        }>(query, { id: parentIssueId });

        return data.issue.children.nodes.map((child) => ({
          id: child.id,
          identifier: child.identifier,
          title: child.title,
          description: child.description,
          priority: child.priority,
          stateName: child.state.name,
          teamId: child.team?.id ?? null,
          teamName: child.team?.name ?? null,
          labels: child.labels.nodes.map((l) => l.name),
        }));
      } catch (err) {
        logger.error({ err, parentIssueId }, "Failed to get child issues");
        return [];
      }
    },

    async postComment(issueId: string, body: string): Promise<void> {
      const mutation = `
        mutation CreateComment($issueId: String!, $body: String!) {
          commentCreate(input: { issueId: $issueId, body: $body }) {
            success
          }
        }
      `;

      await graphqlRequest(mutation, { issueId, body });
      logger.info({ issueId }, "Comment posted to Linear");
    },

    async updateIssueState(
      issueId: string,
      stateName: string
    ): Promise<void> {
      const findStateQuery = `
        query GetIssue($id: String!) {
          issue(id: $id) {
            team {
              states {
                nodes {
                  id
                  name
                }
              }
            }
          }
        }
      `;

      const stateData = await graphqlRequest<{
        issue: {
          team: {
            states: { nodes: Array<{ id: string; name: string }> };
          };
        };
      }>(findStateQuery, { id: issueId });

      const state = stateData.issue.team.states.nodes.find(
        (s) => s.name === stateName
      );

      if (!state) {
        throw new Error(`State "${stateName}" not found in team`);
      }

      const updateMutation = `
        mutation UpdateIssue($id: String!, $stateId: String!) {
          issueUpdate(id: $id, input: { stateId: $stateId }) {
            success
          }
        }
      `;

      await graphqlRequest(updateMutation, {
        id: issueId,
        stateId: state.id,
      });

      logger.info({ issueId, stateName }, "Issue state updated");
    },

    async listTeams(): Promise<LinearTeam[]> {
      const query = `
        query ListTeams {
          teams(first: 100) {
            nodes {
              id
              name
            }
          }
        }
      `;

      const data = await graphqlRequest<{
        teams: { nodes: Array<{ id: string; name: string }> };
      }>(query, {});

      return data.teams.nodes.map((team) => ({
        id: team.id,
        name: team.name,
      }));
    },

    async createTeam(name: string): Promise<LinearTeam> {
      const mutation = `
        mutation CreateTeam($name: String!) {
          teamCreate(input: { name: $name }) {
            success
            team {
              id
              name
            }
          }
        }
      `;

      const data = await graphqlRequest<{
        teamCreate: {
          success: boolean;
          team: { id: string; name: string };
        };
      }>(mutation, { name });

      if (!data.teamCreate.success) {
        throw new Error(`Linear teamCreate failed for "${name}"`);
      }

      return data.teamCreate.team;
    },

    async createWebhook(input: {
      teamId: string;
      url: string;
      label: string;
      secret: string;
    }): Promise<void> {
      const mutation = `
        mutation CreateWebhook(
          $teamId: String!
          $url: String!
          $label: String!
          $secret: String!
        ) {
          webhookCreate(
            input: {
              teamId: $teamId
              url: $url
              label: $label
              secret: $secret
              resourceTypes: [Issue, Comment]
            }
          ) {
            success
          }
        }
      `;

      const data = await graphqlRequest<{
        webhookCreate: { success: boolean };
      }>(mutation, {
        teamId: input.teamId,
        url: input.url,
        label: input.label,
        secret: input.secret,
      });

      if (!data.webhookCreate.success) {
        throw new Error(`Linear webhookCreate failed for "${input.label}"`);
      }

      logger.info({ teamId: input.teamId }, "Webhook created for team");
    },

    async listWebhooks(
      teamId: string
    ): Promise<Array<{ id: string; label: string; resourceTypes: string[] }>> {
      const query = `
        query TeamWebhooks($teamId: String!) {
          team(id: $teamId) {
            webhooks(first: 50) {
              nodes {
                id
                label
                resourceTypes
              }
            }
          }
        }
      `;

      const fallbackQuery = `
        query AllWebhooks {
          webhooks(first: 50) {
            nodes {
              id
              label
              resourceTypes
              team {
                id
              }
            }
          }
        }
      `;

      // Some Linear workspaces don't expose team.webhooks; fall back to the
      // global webhook list and filter by team id.
      try {
        const data = await graphqlRequest<{
          team: {
            webhooks: {
              nodes: Array<{
                id: string;
                label: string;
                resourceTypes: string[];
              }>;
            };
          } | null;
        }>(query, { teamId });
        return data.team?.webhooks.nodes ?? [];
      } catch (err) {
        logger.warn(
          { err, teamId },
          "Team webhooks query failed; falling back to global list"
        );
        const data = await graphqlRequest<{
          webhooks: {
            nodes: Array<{
              id: string;
              label: string;
              resourceTypes: string[];
              team: { id: string };
            }>;
          };
        }>(fallbackQuery, {});
        return data.webhooks.nodes
          .filter((node) => node.team.id === teamId)
          .map(({ id, label, resourceTypes }) => ({
            id,
            label,
            resourceTypes,
          }));
      }
    },

    async updateWebhook(input: {
      webhookId: string;
      resourceTypes: string[];
    }): Promise<void> {
      const mutation = `
        mutation WebhookUpdate($id: String!, $resourceTypes: [String!]!) {
          webhookUpdate(id: $id, input: { resourceTypes: $resourceTypes }) {
            success
          }
        }
      `;

      const data = await graphqlRequest<{
        webhookUpdate: { success: boolean };
      }>(mutation, {
        id: input.webhookId,
        resourceTypes: input.resourceTypes,
      });

      if (!data.webhookUpdate.success) {
        throw new Error(`Linear webhookUpdate failed for "${input.webhookId}"`);
      }

      logger.info(
        { webhookId: input.webhookId },
        "Webhook updated to include Comment events"
      );
    },

    async createIssue(input: {
      teamId: string;
      title: string;
      description: string;
      stateId?: string;
    }): Promise<void> {
      const mutation = `
        mutation IssueCreate($teamId: String!, $title: String!, $description: String, $stateId: String) {
          issueCreate(
            input: { teamId: $teamId, title: $title, description: $description, stateId: $stateId }
          ) {
            success
            issue {
              id
            }
          }
        }
      `;

      const data = await graphqlRequest<{
        issueCreate: { success: boolean; issue: { id: string } | null };
      }>(mutation, {
        teamId: input.teamId,
        title: input.title,
        description: input.description,
        ...(input.stateId ? { stateId: input.stateId } : {}),
      });

      if (!data.issueCreate.success) {
        throw new Error(`Linear issueCreate failed for "${input.title}"`);
      }

      logger.info({ teamId: input.teamId }, "Issue created in Linear");
    },

    async archiveIssue(issueId: string): Promise<void> {
      const mutation = `
        mutation IssueArchive($id: String!) {
          issueArchive(id: $id) {
            success
          }
        }
      `;

      const data = await graphqlRequest<{
        issueArchive: { success: boolean };
      }>(mutation, { id: issueId });

      if (!data.issueArchive.success) {
        throw new Error(`Linear issueArchive failed for "${issueId}"`);
      }

      logger.info({ issueId }, "Issue archived in Linear");
    },

    async listTeamIssues(
      teamId: string
    ): Promise<Array<{ id: string; title: string }>> {
      const query = `
        query TeamIssues($teamId: String!) {
          team(id: $teamId) {
            issues(first: 100) {
              nodes {
                id
                title
              }
            }
          }
        }
      `;

      const data = await graphqlRequest<{
        team: { issues: { nodes: Array<{ id: string; title: string }> } } | null;
      }>(query, { teamId });

      return data.team?.issues.nodes ?? [];
    },

    async listTeamStates(
      teamId: string
    ): Promise<Array<{ id: string; name: string; type: string }>> {
      const query = `
        query TeamStates($teamId: String!) {
          team(id: $teamId) {
            states(first: 50) {
              nodes {
                id
                name
                type
              }
            }
          }
        }
      `;

      const data = await graphqlRequest<{
        team: {
          states: { nodes: Array<{ id: string; name: string; type: string }> };
        } | null;
      }>(query, { teamId });

      return data.team?.states.nodes ?? [];
    },
  };
}
