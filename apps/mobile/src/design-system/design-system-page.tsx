import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { tokens } from '@lode/design-tokens';
import {
  catalogSections,
  overviewPage,
  type CatalogPage,
} from '@lode/design-system-catalog';

import { Button } from '../ui/button';
import { Text } from '../ui/text';
import { ThemeProvider, useColors, type ThemeMode } from '../ui/theme';
import {
  ButtonsPage,
  FormsPage,
  StatusPage,
  SurfacesPage,
} from './component-pages';
import { ColorPage, GeometryPage, TypographyPage } from './foundation-pages';
import { OverviewPage } from './overview-page';
import { ProductPreviewPage } from './product-preview';

export function MobileDesignSystemPage({
  onClose,
}: Readonly<{ onClose: () => void }>) {
  const [page, setPage] = useState<CatalogPage>(overviewPage);
  const [theme, setTheme] = useState<ThemeMode>('light');
  return (
    <ThemeProvider mode={theme}>
      <CatalogScreen
        onClose={onClose}
        onNavigate={setPage}
        onThemeChange={setTheme}
        page={page}
        theme={theme}
      />
    </ThemeProvider>
  );
}

function CatalogScreen({
  onClose,
  onNavigate,
  onThemeChange,
  page,
  theme,
}: Readonly<{
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

      <PageContent page={page} />

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
  const colors = useColors();
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
            <Pressable
              accessibilityRole="button"
              key={sectionPage.id}
              onPress={() => onNavigate(sectionPage)}
              style={({ pressed }) => [
                styles.indexRow,
                { backgroundColor: colors.card, borderColor: colors.border },
                pressed && { opacity: tokens.opacity.pressed },
              ]}
            >
              <View style={styles.indexRowCopy}>
                <Text weight="medium">{sectionPage.title}</Text>
                <Text color="muted-foreground" variant="caption">
                  {sectionPage.description}
                </Text>
              </View>
              <Text color="muted-foreground" variant="title-small">
                ›
              </Text>
            </Pressable>
          ))}
        </View>
      ))}
    </View>
  );
}

function PageContent({ page }: Readonly<{ page: CatalogPage }>) {
  switch (page.id) {
    case 'overview': {
      return <OverviewPage />;
    }
    case 'color': {
      return <ColorPage />;
    }
    case 'typography': {
      return <TypographyPage />;
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
    case 'status': {
      return <StatusPage />;
    }
    case 'surfaces': {
      return <SurfacesPage />;
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
  indexRow: {
    alignItems: 'center',
    borderRadius: tokens.radius.md,
    borderWidth: tokens.stroke.thin,
    flexDirection: 'row',
    gap: tokens.space.sm,
    justifyContent: 'space-between',
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.sm,
  },
  indexRowCopy: { flex: 1, gap: 2, minWidth: 0 },
  footer: {
    borderTopWidth: tokens.stroke.thin,
    marginTop: tokens.space['2xl'],
    paddingTop: tokens.space.lg,
  },
});
