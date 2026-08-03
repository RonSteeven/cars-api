import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { XmlParseError } from '../../shared/errors.js';

/**
 * Shared XML parser configuration.
 *
 * `parseTagValue: false` is the important one. fast-xml-parser will happily turn
 * `<Make_ID>440</Make_ID>` into the number 440 and, worse, `<Make_Name>1/OFF
 * KUSTOMS</Make_Name>` into something unexpected. The vPIC payload is all
 * identifiers and names, the target JSON contract specifies string values, and a
 * make id is an opaque key we never do arithmetic on — so every value stays a
 * string and nothing is silently coerced.
 */
const parser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  // Namespace prefixes (xsi:, xsd:) carry no meaning for us.
  removeNSPrefix: true,
});

/**
 * Parses an XML document into a plain object.
 *
 * fast-xml-parser is lenient by default and will return a partial object for
 * malformed input rather than complain, which would turn a truncated response
 * into silently missing records. Validation therefore runs first and any failure
 * becomes an {@link XmlParseError}.
 *
 * @param xml     Raw XML document.
 * @param source  Human readable origin (a URL, a fixture name) used in errors.
 */
export const parseXml = (xml: string, source: string): unknown => {
  if (xml.trim().length === 0) {
    throw new XmlParseError(`Empty XML document received from ${source}`, {
      context: { source },
    });
  }

  const validation = XMLValidator.validate(xml);
  if (validation !== true) {
    throw new XmlParseError(`Malformed XML received from ${source}: ${validation.err.msg}`, {
      context: {
        source,
        line: validation.err.line,
        column: validation.err.col,
        code: validation.err.code,
      },
    });
  }

  try {
    return parser.parse(xml) as unknown;
  } catch (cause) {
    throw new XmlParseError(
      `Failed to parse XML from ${source}: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause, context: { source } },
    );
  }
};

/**
 * Normalises an XML repeated element into an array.
 *
 * XML has no notion of a list, so a container with one child parses to an object
 * and a container with none parses to an empty string. vPIC hits both cases in
 * production (`<Results />` for an unknown make id, a single
 * `<VehicleTypesForMakeIds>` for most makes), and treating either as "no data"
 * or crashing on `.map` is a bug we would only find with real traffic.
 */
export const toArray = <T>(value: T | readonly T[] | null | undefined): T[] => {
  if (value === null || value === undefined || value === '') return [];
  return Array.isArray(value) ? [...value] : [value as T];
};
