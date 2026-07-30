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
}

export interface LinearClient {
  verifyWebhookSignature(
    payload: string,
    signature: string,
    secret: string
  ): boolean;
  getIssue(issueId: string): Promise<LinearIssue | null>;
  postComment(issueId: string, body: string): Promise<void>;
  updateIssueState(issueId: string, stateName: string): Promise<void>;
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
      return crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature)
      );
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
          labels: data.issue.labels.nodes.map((l) => l.name),
        };
      } catch (err) {
        logger.error({ err, issueId }, "Failed to get issue");
        return null;
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
  };
}
