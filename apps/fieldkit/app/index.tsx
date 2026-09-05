import { View, Text, useWindowDimensions } from 'react-native'
import { darkTheme, spacing } from '@corymbia/tokens'

export default function Home() {
  const { width, height } = useWindowDimensions()
  const c = darkTheme.colors
  return (
    <View style={{ flex: 1, padding: spacing.lg, backgroundColor: c.surface }}>
      <Text style={{ color: c.textPrimary, fontSize: 20, fontWeight: '800' }}>
        Corymbia Field Kit
      </Text>
      <Text style={{ color: c.textDim, marginTop: spacing.sm }}>
        {Math.round(width)}x{Math.round(height)}dp - shortest side{' '}
        {Math.round(Math.min(width, height))}dp
      </Text>
      <Text style={{ color: c.accent, marginTop: spacing.lg, fontWeight: '700' }}>
        Tokens resolved
      </Text>
    </View>
  )
}
