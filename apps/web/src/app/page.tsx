// See LICENSE file in the project root for license information.

import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { faTerminal } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import Link from "next/link";
import type { FontAwesomeIconProps } from "@fortawesome/react-fontawesome";

const items = [
  {
    icon: (props: Omit<FontAwesomeIconProps, "icon">) => (
      <FontAwesomeIcon icon={faTerminal} {...props} />
    ),
    title: "Web Remote Terminal",
    description:
      "Access your terminal directly from a web browser using rstream.",
    slug: "webtty",
  },
];

export default function Page() {
  return (
    <div className="py-12">
      <div className="space-y-4">
        <h1 className="text-xl font-bold text-foreground text-balance">
          Tools
        </h1>
        <div className="text-md text-muted-foreground">
          A collection tools built using rstream primitives.
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          {items.map((item) => (
            <Card key={item.slug} className="relative">
              <CardHeader className="space-y-2">
                <CardTitle>
                  <Link href={item.slug}>
                    <span className="absolute inset-x-0 -top-px bottom-0" />
                    <div className="space-y-4">
                      <item.icon
                        className={cn("h-10 w-auto")}
                        fill="currentColor"
                        aria-hidden="true"
                      />
                      <p>{item.title}</p>
                    </div>
                  </Link>
                </CardTitle>
                <CardDescription>{item.description}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
