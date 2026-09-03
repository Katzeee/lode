import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { tokens } from '@lode/design-tokens';
import {
  catalogPageIcons,
  catalogSections,
  overviewPage,
  type CatalogPage,
} from '@lode/design-system-catalog';

import { Button } from '../ui/button';
import { NavRow } from '../ui/nav';
import { Text } from '../ui/text';
import { ToastProvider } from '../ui/toast';
import {
  ThemeProvider,
  useColors,
  type ThemeName,
  type ThemeMode,
} from '../ui/theme';
import {
  ButtonsPage,
  FormsPage,
  StatusPage,
  SurfacesPage,
} from './component-pages';
import { ColorPage, GeometryPage, TypographyPage } from './foundation-pages';
import { ContentPage } from './content-page';
import { OverviewPage } from './overview-page';
import { OverlaysPage } from './overlays-page';
import { LayoutPage } from './layout-page';
import { ProductPreviewPage } from './product-preview';
import { ThemingPage } from './theming-page';

export function MobileDesignSystemPage({
  onClose,
}: Readonly<{ onClose: () => void }>) {
  const [page, setPage] = useState<CatalogPage>(overviewPage);
  const [theme, setTheme] = useState<ThemeMode>('light');
  const [themeName, setThemeName] = useState<ThemeName>('forest');
  return (
    <ThemeProvider mode={theme} name={themeName}>
      <ToastProvider>
        <CatalogScreen
          onClose={onClose}
          onNavigate={setPage}
          onThemeChange={setTheme}
          onThemeNameChange={setThemeName}
          page={page}
          theme={theme}
          themeName={themeName}
        />
      </ToastProvider>
    </ThemeProvider>
  );
}

function CatalogScreen({
  themeName,
  onThemeNameChange,
  onClose,
  onNavigate,
  onThemeChange,
  page,
  theme,
}: Readonly<{
  themeName: ThemeName;
  onThemeNameChange: (theme: ThemeName) => void;
  onClose: () => void;
  onNavigate: (page: CatalogPage) => void;
  onThemeChange: (mode: ThemeMode) => void;
  page: CatalogPage;
  theme: ThemeMode;
}>) {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  return (
    <ScrollView
      contentContainerStyle={[
        styles.page,
        {
          paddingBottom: insets.bottom + tokens.space['4xl'],
          paddingTop: insets.top + tokens.space.md,
        },
      ]}
      key={page.id}
      style={{ backgroundColor: colors.background, flex: 1 }}
    >
      <View style={styles.topbar}>
        {page.id === 'overview' ? (
          <Button onPress={onClose} size="sm" variant="outline">
            Close
          </Button>
        ) : (
          <Button
            onPress={() => onNavigate(overviewPage)}
            size="sm"
            variant="outline"
          >
            ← Overview
          </Button>
        )}
        <Button
          onPress={() => onThemeChange(theme === 'light' ? 'dark' : 'light')}
          size="sm"
          variant="ghost"
        >
          {theme === 'light' ? 'Dark theme' : 'Light theme'}
        </Button>
      </View>

      <PageContent
        themeName={themeName}
        onThemeNameChange={onThemeNameChange}
        page={page}
      />

      {page.id === 'overview' ? <CatalogIndex onNavigate={onNavigate} /> : null}

      <View style={[styles.footer, { borderTopColor: colors.border }]}>
        <Text color="muted-foreground" variant="caption">
          Lode Design System — one token source, one component layer.
        </Text>
      </View>
    </ScrollView>
  );
}

function CatalogIndex({
  onNavigate,
}: Readonly<{ onNavigate: (page: CatalogPage) => void }>) {
  return (
    <View style={styles.index}>
      {catalogSections.map(section => (
        <View key={section.id} style={styles.indexSection}>
          <Text
            color="muted-foreground"
            style={styles.indexTitle}
            variant="caption"
            weight="semibold"
          >
            {section.title.toUpperCase()}
          </Text>
          {section.pages.map(sectionPage => (
            <NavRow
              description={sectionPage.description}
              icon={catalogPageIcons[sectionPage.id]}
              key={sectionPage.id}
              onPress={() => onNavigate(sectionPage)}
              title={sectionPage.title}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

function PageContent({
  themeName,
  onThemeNameChange,
  page,
}: Readonly<{
  themeName: ThemeName;
  onThemeNameChange: (theme: ThemeName) => void;
  page: CatalogPage;
}>) {
  switch (page.id) {
    case 'overview': {
      return <OverviewPage />;
    }
    case 'color': {
      return <ColorPage />;
    }
    case 'theming': {
      return (
        <ThemingPage onThemeChange={onThemeNameChange} theme={themeName} />
      );
    }
    case 'typography': {
      return <TypographyPage />;
    }
    case 'content': {
      return <ContentPage />;
    }
    case 'geometry': {
      return <GeometryPage />;
    }
    case 'buttons': {
      return <ButtonsPage />;
    }
    case 'forms': {
      return <FormsPage />;
    }
    case 'overlays': {
      return <OverlaysPage />;
    }
    case 'status': {
      return <StatusPage />;
    }
    case 'surfaces': {
      return <SurfacesPage />;
    }
    case 'layouts': {
      return <LayoutPage />;
    }
    case 'product': {
      return <ProductPreviewPage />;
    }
  }
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: tokens.space.lg },
  topbar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: tokens.space.xl,
  },
  index: { gap: tokens.space.lg },
  indexSection: { gap: tokens.space.xs },
  indexTitle: { letterSpacing: 1.1, marginBottom: tokens.space['2xs'] },
  footer: {
    borderTopWidth: tokens.stroke.thin,
    marginTop: tokens.space['2xl'],
    paddingTop: tokens.space.lg,
  },
});
