import { writeFileSync } from "node:fs";
import { parse } from "@babel/parser";

type Source = {
  file: string;
  source: string;
};

const sources: Source[] = [
  {
    file: "examples/input.json",
    source: `
const greeting = "Hello";

<div className="app">
  <header>
    <h1>{greeting}, world!</h1>
  </header>
  <main>
    <ul>
      {items.map((item) => (
        <li key={item.id}>{item.label}</li>
      ))}
    </ul>
  </main>
</div>
`,
  },
  {
    file: "examples/card.json",
    source: `
const profile: User = currentUser;

<div className="card">
  <img src={profile.avatar} alt={profile.name} />
  <div className="card-body">
    <h2>{profile.name}</h2>
    <p className="bio">{profile.bio}</p>
    {profile.verified ? <Badge type="verified" /> : null}
    <div className="actions">
      <button onClick={() => onFollow(profile.id)} disabled={profile.following}>
        {profile.following ? "Following" : "Follow"}
      </button>
    </div>
  </div>
</div>
`,
  },
];

const asts = sources.map(({ source }) =>
  parse(source, { sourceType: "module", plugins: ["jsx", "typescript"] }),
);

asts.forEach((ast, i) => {
  const { file } = sources[i];
  const jsxElement = ast.program.body.find(
    (node) =>
      node.type === "ExpressionStatement" &&
      node.expression.type === "JSXElement",
  );

  if (!jsxElement || jsxElement.type !== "ExpressionStatement") {
    throw new Error(`No JSX element found in ${file}`);
  }

  writeFileSync(file, JSON.stringify(jsxElement.expression, null, 2));
  console.log(`Wrote ${file}`);
});
