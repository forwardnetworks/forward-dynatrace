import { PageLayout } from "@dynatrace/strato-components/layouts";
import React from "react";
import { Header } from "./components/Header";
import { Home } from "./pages/Home";

export const App = () => {
  return (
    <PageLayout>
      <PageLayout.Header>
        <Header />
      </PageLayout.Header>
      <PageLayout.Content>
        <Home />
      </PageLayout.Content>
    </PageLayout>
  );
};
