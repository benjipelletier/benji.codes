import Head from "next/head";
import "../styles/globals.css";

export default function App({ Component, pageProps }) {
  return (
    <>
      <Head>
        <title>歌词接龙 — Lyric Chain Explorer</title>
        <meta name="description" content="Explore chains of Chinese song lyrics — where the last character of one line connects to the first of the next." />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <Component {...pageProps} />
    </>
  );
}
