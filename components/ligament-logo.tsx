interface LigamentLogoProps {
  variant?: 'primary' | 'accent' | 'light' | 'ink' | 'electric' | 'outline'
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'icon' | 'favicon'
  className?: string
}

export function LigamentLogo({ 
  variant = 'primary', 
  size = 'md',
  className = '' 
}: LigamentLogoProps) {
  // Size configurations based on brand scale system
  const sizeConfig = {
    favicon: { width: 32, height: 32, fontSize: 20, letterSpacing: 0, isIcon: true },
    icon: { width: 52, height: 52, fontSize: 32, letterSpacing: 0, isIcon: true },
    xs: { width: 96, height: 24, fontSize: 14, letterSpacing: 1, isIcon: false },
    sm: { width: 150, height: 36, fontSize: 22, letterSpacing: 1.5, isIcon: false },
    md: { width: 220, height: 52, fontSize: 32, letterSpacing: 2, isIcon: false },
    lg: { width: 440, height: 100, fontSize: 64, letterSpacing: 5, isIcon: false },
  }

  // Color configurations based on brand colorways
  const colorConfig = {
    primary: { bg: '#0C3535', text: '#E8F5F0', stroke: 'none' },
    accent: { bg: '#C8F53C', text: '#0C1C0C', stroke: 'none' },
    light: { bg: '#F5F2EC', text: '#0C1C1A', stroke: 'none' },
    ink: { bg: '#0A0A0A', text: '#F0EDEA', stroke: 'none' },
    electric: { bg: '#0C3535', text: '#C8F53C', stroke: 'none' },
    outline: { bg: 'none', text: '#0C3535', stroke: '#0C3535' },
  }

  const config = sizeConfig[size]
  const colors = colorConfig[variant]

  if (config.isIcon) {
    // Icon/Avatar/Favicon - just the "L"
    return (
      <svg 
        width={config.width} 
        height={config.height} 
        viewBox={`0 0 ${config.width} ${config.height}`} 
        fill="none" 
        xmlns="http://www.w3.org/2000/svg"
        className={className}
      >
        {colors.stroke !== 'none' ? (
          <rect x="1" y="1" width={config.width - 2} height={config.height - 2} fill="none" stroke={colors.stroke} strokeWidth="2"/>
        ) : (
          <rect width={config.width} height={config.height} fill={colors.bg}/>
        )}
        <text 
          x={config.width * 0.15} 
          y={config.height * 0.72}
          fontFamily="'Barlow Condensed', sans-serif"
          fontSize={config.fontSize}
          fontWeight="900"
          fill={colors.text}
        >
          L
        </text>
      </svg>
    )
  }

  // Full wordmark
  const textX = size === 'xs' ? 5 : size === 'sm' ? 8 : size === 'md' ? 12 : 22
  const textY = size === 'xs' ? 17 : size === 'sm' ? 26 : size === 'md' ? 38 : 72

  return (
    <svg 
      width={config.width} 
      height={config.height} 
      viewBox={`0 0 ${config.width} ${config.height}`} 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {colors.stroke !== 'none' ? (
        <rect x="1" y="1" width={config.width - 2} height={config.height - 2} fill="none" stroke={colors.stroke} strokeWidth="2"/>
      ) : (
        <rect width={config.width} height={config.height} fill={colors.bg}/>
      )}
      <text 
        x={textX} 
        y={textY}
        fontFamily="'Barlow Condensed', sans-serif"
        fontSize={config.fontSize}
        fontWeight="800"
        fill={colors.text}
        letterSpacing={config.letterSpacing}
      >
        LIGAMENT
      </text>
    </svg>
  )
}

// Text-based logo for use in layouts (matches previous LigamentLogoText interface)
export function LigamentLogoText({ 
  variant = 'primary',
  size = 'md',
  className = '' 
}: LigamentLogoProps) {
  const sizeConfig = {
    favicon: { logoSize: 'favicon' as const },
    icon: { logoSize: 'icon' as const },
    xs: { logoSize: 'xs' as const },
    sm: { logoSize: 'sm' as const },
    md: { logoSize: 'md' as const },
    lg: { logoSize: 'lg' as const },
  }

  return (
    <div className={className}>
      <LigamentLogo variant={variant} size={sizeConfig[size].logoSize} />
    </div>
  )
}
