import { ImageResponse } from 'next/og'
import { NextRequest } from 'next/server'

export const runtime = 'edge'

export async function GET(request: NextRequest) {
  try {
    // Load Barlow Condensed ExtraBold (800) from Google Fonts
    const fontUrl = 'https://fonts.gstatic.com/s/barlowcondensed/v12/HTxwL3I-JCGChYJ8VI-L6OO_au7B6xTru1H2lq0La6JN.ttf'
    
    const fontResponse = await fetch(fontUrl)
    if (!fontResponse.ok) {
      throw new Error('Failed to fetch font')
    }
    const fontData = await fontResponse.arrayBuffer()

    const { searchParams } = new URL(request.url)
    const size = searchParams.get('size') || 'md'
    
    // Size configurations matching the LigamentLogo component exactly
    const sizes: Record<string, { width: number; height: number; fontSize: number; letterSpacing: number }> = {
      sm: { width: 150, height: 36, fontSize: 22, letterSpacing: 1.5 },
      md: { width: 220, height: 52, fontSize: 32, letterSpacing: 2 },
      lg: { width: 440, height: 100, fontSize: 64, letterSpacing: 5 },
      xl: { width: 600, height: 140, fontSize: 88, letterSpacing: 7 },
      email: { width: 400, height: 96, fontSize: 48, letterSpacing: 4 },
    }
    
    const config = sizes[size] || sizes.md

    return new ImageResponse(
      (
        <div
          style={{
            background: '#0C3535',
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-start',
            paddingLeft: size === 'sm' ? 8 : size === 'md' ? 12 : size === 'lg' ? 22 : 30,
          }}
        >
          <span
            style={{
              color: '#E8F5F0',
              fontSize: config.fontSize,
              fontFamily: 'Barlow Condensed',
              fontWeight: 800,
              letterSpacing: config.letterSpacing,
            }}
          >
            LIGAMENT
          </span>
        </div>
      ),
      {
        width: config.width,
        height: config.height,
        fonts: [
          {
            name: 'Barlow Condensed',
            data: fontData,
            style: 'normal',
            weight: 800,
          },
        ],
      }
    )
  } catch (error) {
    console.error('Logo generation error:', error)
    
    // Fallback without custom font
    const { searchParams } = new URL(request.url)
    const size = searchParams.get('size') || 'md'
    
    const sizes: Record<string, { width: number; height: number; fontSize: number }> = {
      sm: { width: 150, height: 36, fontSize: 20 },
      md: { width: 220, height: 52, fontSize: 28 },
      lg: { width: 440, height: 100, fontSize: 56 },
      xl: { width: 600, height: 140, fontSize: 76 },
      email: { width: 400, height: 96, fontSize: 42 },
    }
    
    const config = sizes[size] || sizes.md

    return new ImageResponse(
      (
        <div
          style={{
            background: '#0C3535',
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <span
            style={{
              color: '#E8F5F0',
              fontSize: config.fontSize,
              fontWeight: 900,
              letterSpacing: '0.15em',
            }}
          >
            LIGAMENT
          </span>
        </div>
      ),
      {
        width: config.width,
        height: config.height,
      }
    )
  }
}
