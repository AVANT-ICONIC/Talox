export interface TaloxToolParameter {
  type: string;
  description?: string;
  enum?: string[];
  properties?: Record<string, TaloxToolParameter>;
  required?: string[];
  items?: TaloxToolParameter;
}

export interface TaloxTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, TaloxToolParameter>;
      required?: string[];
    };
  };
}

export interface TaloxToolSet {
  tools: TaloxTool[];
  version: string;
}

export function getTaloxTools(): TaloxTool[] {
  return [
    {
      type: "function",
      function: {
        name: "talox_navigate",
        description: "Navigate to a URL and get structured page state. Use stealth mode for anti-detection, debug mode for full observability.",
        parameters: {
          type: "object",
          properties: {
            url: {
              type: "string",
              description: "Target URL to navigate to"
            },
            mode: {
              type: "string",
              description: "Browser mode: stealth (anti-bot), debug (full observability), speed (maximum throughput), balanced (default), browse (human-like), qa (testing)",
              enum: ["stealth", "debug", "speed", "balanced", "browse", "qa"]
            },
            waitUntil: {
              type: "string",
              description: "When to consider navigation complete",
              enum: ["load", "domcontentloaded", "networkidle", "commit"]
            }
          },
          required: ["url"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "talox_click",
        description: "Click an element on the page using a CSS selector or accessible name. Uses human-like mouse movement.",
        parameters: {
          type: "object",
          properties: {
            selector: {
              type: "string",
              description: "CSS selector or accessible name of element to click"
            },
            waitForNavigation: {
              type: "boolean",
              description: "Wait for navigation after click"
            }
          },
          required: ["selector"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "talox_type",
        description: "Type text into an input field with human-like keystroke simulation.",
        parameters: {
          type: "object",
          properties: {
            selector: {
              type: "string",
              description: "CSS selector of input field"
            },
            text: {
              type: "string",
              description: "Text to type"
            },
            clearFirst: {
              type: "boolean",
              description: "Clear existing text before typing"
            }
          },
          required: ["selector", "text"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "talox_get_state",
        description: "Get current page state including AX-Tree, interactive elements, console logs, and network failures.",
        parameters: {
          type: "object",
          properties: {
            perceptionDepth: {
              type: "string",
              description: "Depth of AX-Tree perception",
              enum: ["shallow", "full"]
            }
          }
        }
      }
    },
    {
      type: "function",
      function: {
        name: "talox_describe_page",
        description: "Get a human-readable description of the current page including structure, forms, and interactive elements.",
        parameters: {
          type: "object",
          properties: {}
        }
      }
    },
    {
      type: "function",
      function: {
        name: "talox_get_intent_state",
        description: "Get compact intent-focused state: page type, primary action, inputs, and errors. Use for quick decision making.",
        parameters: {
          type: "object",
          properties: {}
        }
      }
    },
    {
      type: "function",
      function: {
        name: "talox_screenshot",
        description: "Take a screenshot of the full page or a specific element.",
        parameters: {
          type: "object",
          properties: {
            selector: {
              type: "string",
              description: "Optional CSS selector to capture specific element"
            },
            path: {
              type: "string",
              description: "Optional path to save screenshot"
            }
          }
        }
      }
    },
    {
      type: "function",
      function: {
        name: "talox_scroll_to",
        description: "Scroll an element into view with smooth scrolling.",
        parameters: {
          type: "object",
          properties: {
            selector: {
              type: "string",
              description: "CSS selector of element to scroll into view"
            },
            align: {
              type: "string",
              description: "Alignment when scrolling",
              enum: ["start", "center", "end", "nearest"]
            }
          }
        }
      }
    },
    {
      type: "function",
      function: {
        name: "talox_extract_table",
        description: "Extract table data as JSON array of objects.",
        parameters: {
          type: "object",
          properties: {
            selector: {
              type: "string",
              description: "CSS selector of table element"
            }
          },
          required: ["selector"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "talox_wait_for_load_state",
        description: "Wait for a specific page load state.",
        parameters: {
          type: "object",
          properties: {
            state: {
              type: "string",
              description: "Load state to wait for",
              enum: ["load", "domcontentloaded", "networkidle"]
            },
            timeout: {
              type: "number",
              description: "Timeout in milliseconds (default 30000)"
            }
          },
          required: ["state"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "talox_set_mode",
        description: "Switch between browser modes at runtime.",
        parameters: {
          type: "object",
          properties: {
            mode: {
              type: "string",
              description: "Target mode",
              enum: ["stealth", "debug", "speed", "balanced", "browse", "qa"]
            }
          },
          required: ["mode"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "talox_verify_visual",
        description: "Compare current page screenshot with a baseline for visual regression testing.",
        parameters: {
          type: "object",
          properties: {
            baselineKey: {
              type: "string",
              description: "Identifier for the baseline screenshot"
            },
            autoSave: {
              type: "boolean",
              description: "Auto-save current as baseline if no match found"
            }
          },
          required: ["baselineKey"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "talox_find_element",
        description: "Find an element by text content or accessible name within the page.",
        parameters: {
          type: "object",
          properties: {
            text: {
              type: "string",
              description: "Text or accessible name to search for"
            },
            elementType: {
              type: "string",
              description: "Filter by element type",
              enum: ["button", "link", "input", "checkbox", "radio", "menuitem", "any"]
            }
          },
          required: ["text"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "talox_evaluate",
        description: "Execute JavaScript code in the browser context and return the result.",
        parameters: {
          type: "object",
          properties: {
            script: {
              type: "string",
              description: "JavaScript code to execute"
            }
          },
          required: ["script"]
        }
      }
    }
  ];
}

export function getToolNames(): string[] {
  return getTaloxTools().map(t => t.function.name);
}
