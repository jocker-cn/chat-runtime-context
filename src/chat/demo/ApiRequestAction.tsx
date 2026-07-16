import { useEffect, useState } from "react";

const DEFAULT_ENDPOINT = "https://jsonplaceholder.typicode.com/todos/1";

type ApiRequestState =
  | { status: "loading" }
  | { status: "success"; result: string }
  | { status: "error"; message: string };

export interface ApiRequestActionProps {
  endpoint?: string;
  fetcher?: typeof fetch;
}

export function ApiRequestAction({
  endpoint = DEFAULT_ENDPOINT,
  fetcher = fetch,
}: ApiRequestActionProps) {
  const [state, setState] = useState<ApiRequestState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });

    const request = async () => {
      try {
        const response = await fetcher(endpoint, {
          headers: {
            Accept: "application/json",
          },
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`Request failed with status ${response.status}`);
        }

        const contentType = response.headers.get("content-type") ?? "";
        const result = contentType.includes("application/json")
          ? JSON.stringify(await response.json(), null, 2)
          : await response.text();

        if (!controller.signal.aborted) {
          setState({ status: "success", result });
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    };

    void request();

    return () => {
      controller.abort();
    };
  }, [endpoint, fetcher]);

  return (
    <div className="api-request-action">
      {state.status === "loading" ? (
        <span className="api-request-status" role="status">
          Loading API response...
        </span>
      ) : null}

      {state.status === "success" ? (
        <pre className="api-request-result" aria-label="API response">
          <code>{state.result}</code>
        </pre>
      ) : null}

      {state.status === "error" ? (
        <p className="api-request-error" role="alert">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
